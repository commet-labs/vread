import { randomUUID } from "node:crypto";
import {
  authenticate,
  buildUpstreamRequest,
  RequestError,
  resolveOperation,
} from "./policy";
import { redact } from "./redaction";

const maxRequestBytes = 64 * 1024;
const maxResponseBytes = 2 * 1024 * 1024;

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  snapshotWindowMs?: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const timer =
    snapshotWindowMs === undefined
      ? undefined
      : setTimeout(() => {
          truncated = true;
          void reader.cancel().catch(() => undefined);
        }, snapshotWindowMs);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        if (snapshotWindowMs !== undefined) {
          truncated = true;
          break;
        }
        throw new RequestError(
          413,
          "payload_too_large",
          "Payload exceeds the service limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function decodeResponse(text: string, contentType: string): unknown {
  if (!text) return [];
  if (
    contentType.includes("ndjson") ||
    contentType.includes("jsonl") ||
    contentType.includes("stream+json")
  )
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  if (contentType.includes("text/event-stream"))
    return text
      .split(/\r?\n\r?\n/)
      .filter((event) => event.trim())
      .flatMap((event) => {
        const payload = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        return payload && payload !== "[DONE]" ? [JSON.parse(payload)] : [];
      });
  if (contentType.includes("application/json") || contentType.includes("+json"))
    return JSON.parse(text);
  throw new RequestError(
    502,
    "unsupported_upstream_format",
    "Only structured JSON and JSON event streams are returned.",
  );
}

export async function handleRead(
  request: Request,
  operationId: string,
): Promise<Response> {
  const requestId = randomUUID();
  let upstreamStatus: number | undefined;
  try {
    const serviceKey = process.env.VERCEL_READ_API_KEY;
    if (!serviceKey || serviceKey.length < 32)
      throw new RequestError(
        503,
        "not_configured",
        "Service authentication is not configured.",
      );
    if (!authenticate(request.headers.get("authorization"), serviceKey))
      throw new RequestError(
        401,
        "unauthorized",
        "A valid service API key is required.",
      );
    const operation = resolveOperation(operationId, request.method);
    if (request.url.length > 8192)
      throw new RequestError(414, "uri_too_long", "Query is too long.");
    const upstreamToken = process.env.VERCEL_UPSTREAM_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    if (
      !upstreamToken ||
      !teamId?.startsWith("team_") ||
      upstreamToken === serviceKey
    )
      throw new RequestError(
        503,
        "not_configured",
        "Upstream credentials and team must be configured separately.",
      );
    let body: unknown;
    const { text: rawBody } = await readBounded(request.body, maxRequestBytes);
    if (rawBody) {
      if (
        !request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        throw new RequestError(
          415,
          "unsupported_media_type",
          "Query bodies must use application/json.",
        );
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new RequestError(
          400,
          "invalid_json",
          "Request body is not valid JSON.",
        );
      }
    }
    const upstreamRequest = buildUpstreamRequest(
      operation,
      new URL(request.url).searchParams,
      body,
      teamId,
      process.env.VERCEL_TEAM_SLUG,
    );
    const response = await fetch(upstreamRequest.url, {
      method: operation.method,
      headers: {
        Authorization: `Bearer ${upstreamToken}`,
        Accept: "application/json, application/x-ndjson, text/event-stream",
        ...(upstreamRequest.body ? { "Content-Type": "application/json" } : {}),
      },
      body: upstreamRequest.body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });
    upstreamStatus = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new RequestError(
        502,
        "upstream_redirect_blocked",
        "Upstream redirects are not followed.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      return jsonResponse(
        {
          error: {
            code: "upstream_error",
            message: "Vercel rejected this read request.",
            upstreamStatus: response.status,
          },
          requestId,
        },
        response.status >= 500 ? 502 : response.status,
      );
    }
    if (operation.method === "HEAD")
      return jsonResponse({ exists: true, upstreamStatus: response.status });
    let upstreamPayload: unknown;
    let streamTruncated = false;
    const contentType = (
      response.headers.get("content-type") ?? ""
    ).toLowerCase();
    const streaming = /ndjson|jsonl|stream\+json|text\/event-stream/.test(
      contentType,
    );
    try {
      const snapshot = await readBounded(
        response.body,
        maxResponseBytes,
        streaming ? 5_000 : undefined,
      );
      streamTruncated = snapshot.truncated;
      let text = snapshot.text;
      if (streamTruncated) {
        const separator = contentType.includes("text/event-stream")
          ? /\r?\n\r?\n/g
          : /\n/g;
        const boundaries = [...text.matchAll(separator)];
        const boundary = boundaries.at(-1);
        text = boundary
          ? text.slice(0, boundary.index + boundary[0].length)
          : "";
      }
      upstreamPayload = decodeResponse(text, contentType);
    } catch (error) {
      if (error instanceof RequestError && error.status === 413)
        throw new RequestError(
          502,
          "upstream_response_too_large",
          "Narrow the query or use pagination.",
        );
      if (error instanceof RequestError) throw error;
      if (error instanceof DOMException) throw error;
      throw new RequestError(
        502,
        "invalid_upstream_response",
        "Upstream did not return a supported structured response.",
      );
    }
    if (
      operationId === "getTeams" &&
      upstreamPayload &&
      typeof upstreamPayload === "object" &&
      "teams" in upstreamPayload &&
      Array.isArray(upstreamPayload.teams)
    )
      upstreamPayload.teams = upstreamPayload.teams.filter(
        (team: { id?: string }) => team.id === teamId,
      );
    const clientResponse = jsonResponse(
      redact(upstreamPayload, [serviceKey, upstreamToken]),
    );
    if (streaming) {
      clientResponse.headers.set(
        "X-Vercel-Read-Stream-Complete",
        String(!streamTruncated),
      );
      clientResponse.headers.set("X-Vercel-Read-Snapshot-Ms", "5000");
    }
    return clientResponse;
  } catch (error) {
    if (error instanceof RequestError)
      return jsonResponse(
        { error: { code: error.code, message: error.message }, requestId },
        error.status,
      );
    if (
      error instanceof DOMException &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      return jsonResponse(
        {
          error: {
            code: "upstream_timeout",
            message: "Read timed out or was cancelled.",
          },
          requestId,
        },
        504,
      );
    return jsonResponse(
      {
        error: {
          code: "upstream_unavailable",
          message: "Unable to complete this read.",
        },
        requestId,
      },
      502,
    );
  } finally {
    console.info(
      JSON.stringify({
        event: "vercel_read",
        requestId,
        operationId: /^[a-zA-Z0-9_-]{1,120}$/.test(operationId)
          ? operationId
          : "invalid",
        method: request.method,
        upstreamStatus,
      }),
    );
  }
}
