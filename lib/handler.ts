import { createHash, timingSafeEqual } from "node:crypto";

const requestHeaders = [
  "accept",
  "accept-language",
  "range",
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "x-vercel-api-version",
  "x-artifact-client-ci",
  "x-artifact-client-interactive",
];
const transportHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
];

export function authenticate(
  authorization: string | null,
  serviceKey: string,
): boolean {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512)
    return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(serviceKey));
}

export function upstreamUrl(requestUrl: string): URL {
  const incoming = new URL(requestUrl);
  const upstream = new URL("https://api.vercel.com");
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  return upstream;
}

function proxyError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function rejectMethod(): Response {
  const response = proxyError(
    405,
    "method_not_allowed",
    "Only GET is supported.",
  );
  response.headers.set("Allow", "GET");
  return response;
}

export async function handleGet(request: Request): Promise<Response> {
  if (request.method !== "GET") return rejectMethod();
  const serviceKey = process.env.VREAD_API_KEY;
  if (!serviceKey || serviceKey.length < 32)
    return proxyError(
      503,
      "not_configured",
      "Service authentication is not configured.",
    );
  if (!authenticate(request.headers.get("authorization"), serviceKey))
    return proxyError(
      401,
      "unauthorized",
      "A valid service API key is required.",
    );
  const token = process.env.VREAD_UPSTREAM_TOKEN;
  if (!token || token === serviceKey)
    return proxyError(
      503,
      "not_configured",
      "A separate upstream token is required.",
    );
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const upstream = await fetch(upstreamUrl(request.url), {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of (responseHeaders.get("connection") ?? "").split(",")) {
      if (name.trim()) responseHeaders.delete(name.trim());
    }
    for (const name of transportHeaders) responseHeaders.delete(name);
    responseHeaders.set("Cache-Control", "private, no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return proxyError(502, "upstream_unavailable", "Unable to reach Vercel.");
  }
}
