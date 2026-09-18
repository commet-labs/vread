import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import configuration from "../access-policy";

const apiKey = "vercel_read_e2e_key_longer_than_32_characters";
const authorization = `Bearer ${apiKey}`;

test("GET proxy preserves native HTTP contracts and rejects every other method", async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let logs = "";
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_OPTIONS: `--import=${fileURLToPath(new URL("./upstream-fixture.mjs", import.meta.url))}`,
        VREAD_API_KEY: apiKey,
        VREAD_UPSTREAM_TOKEN: "upstream_fixture_credential",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(`${origin}/openapi.json`)).ok;
      } catch {}
      if (ready) break;
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    const spec = await (await fetch(`${origin}/openapi.json`)).json();
    assert.equal(spec.info.title, "VRead");
    if (configuration.enabled) {
      assert.deepEqual(Object.keys(spec.paths).sort(), [
        "/v10/projects",
        "/v13/deployments/{idOrUrl}",
      ]);
      for (const path of [
        "/v9/projects",
        "/v1/projects/example/env/example",
        "/v2/sandboxes/example?resume=true",
        "/v13/deployments/a%252fb",
        "/undocumented",
      ]) {
        const blocked = await fetch(`${origin}${path}`, {
          headers: { authorization },
        });
        assert.equal(blocked.status, 403, path);
        assert.equal(
          (await blocked.json()).error.code,
          "operation_not_allowed",
        );
      }
      assert.equal(logs.includes("UPSTREAM_FIXTURE"), false);
      const allowed = await fetch(
        `${origin}/v10/projects?limit=1&repeat=a&repeat=b`,
        {
          headers: { authorization },
        },
      );
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get("etag"), '"fixture"');
      assert.equal(
        await allowed.text(),
        '{ "id": "prj_fixture", "env": [{"value":"unchanged"}], "token": "unchanged" }\n',
      );
      assert.equal((await fetch(`${origin}/v10/projects`)).status, 401);
      assert.equal(
        (
          await fetch(`${origin}/v10/projects`, {
            method: "POST",
            headers: { authorization },
          })
        ).status,
        405,
      );
      const calls = logs
        .split("\n")
        .filter((line) => line.startsWith("UPSTREAM_FIXTURE "))
        .map((line) => JSON.parse(line.slice("UPSTREAM_FIXTURE ".length)));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].query, "?limit=1&repeat=a&repeat=b");
      return;
    }
    assert.ok(spec.paths["/v9/projects/{idOrName}"].get.responses["200"]);
    assert.ok(spec.paths["/v1/projects/{idOrName}/env/{id}"].get);
    for (const entry of Object.values(spec.paths)) {
      assert.ok(entry && typeof entry === "object");
      assert.deepEqual(
        Object.keys(entry).filter((key) => key !== "parameters"),
        ["get"],
      );
    }
    assert.equal((await fetch(`${origin}/v9/projects/vread`)).status, 401);
    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]) {
      for (const path of ["/v9/projects/vread", "/openapi.json"]) {
        const denied = await fetch(`${origin}${path}`, {
          method,
          headers: { authorization },
        });
        assert.equal(denied.status, 405);
        assert.equal(denied.headers.get("allow"), "GET");
      }
    }
    assert.equal(logs.includes("UPSTREAM_FIXTURE"), false);
    const nativePath =
      "/v9/projects/vread?teamId=team_example&unknown=a%2Fb&repeat=1&repeat=2";
    const response = await fetch(`${origin}${nativePath}`, {
      headers: {
        authorization,
        "x-http-method-override": "DELETE",
        "x-artifact-client-ci": "true",
        "x-artifact-client-interactive": "false",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("etag"), '"fixture"');
    assert.equal(response.headers.get("x-vercel-id"), "fixture-request");
    assert.equal(
      await response.text(),
      '{ "id": "prj_fixture", "env": [{"value":"unchanged"}], "token": "unchanged" }\n',
    );
    assert.equal(
      (
        await fetch(`${origin}/v2/sandboxes/example?resume=true`, {
          headers: { authorization },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${origin}/v1/projects/prj_example/env/env_example`, {
          headers: { authorization },
        })
      ).status,
      200,
    );
    const error = await fetch(`${origin}/fixture/error`, {
      headers: { authorization },
    });
    assert.equal(error.status, 404);
    assert.equal(
      await error.text(),
      '{"error":{"code":"deployment_not_found","message":"Deployment does not exist","detail":42}}',
    );
    const rateLimit = await fetch(`${origin}/fixture/rate-limit`, {
      headers: { authorization },
    });
    assert.equal(rateLimit.status, 429);
    assert.equal(rateLimit.headers.get("retry-after"), "30");
    const upstreamError = await fetch(`${origin}/fixture/server-error`, {
      headers: { authorization },
    });
    assert.equal(upstreamError.status, 503);
    assert.equal(await upstreamError.text(), "upstream failure");
    const redirect = await fetch(`${origin}/fixture/redirect`, {
      headers: { authorization },
      redirect: "manual",
    });
    assert.equal(redirect.status, 307);
    assert.equal(
      redirect.headers.get("location"),
      "https://example.invalid/target",
    );
    const unchanged = await fetch(`${origin}/fixture/not-modified`, {
      headers: { authorization },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");
    const binary = await fetch(`${origin}/fixture/binary`, {
      headers: { authorization, Range: "bytes=0-4" },
    });
    assert.equal(binary.status, 206);
    assert.equal(binary.headers.get("content-range"), "bytes 0-4/10");
    assert.deepEqual(
      new Uint8Array(await binary.arrayBuffer()),
      new Uint8Array([0, 1, 127, 128, 255]),
    );
    const abort = new AbortController();
    const events = await fetch(`${origin}/fixture/events`, {
      headers: { authorization },
      signal: abort.signal,
    });
    assert.match(
      events.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    assert.ok(events.body);
    const reader = events.body.getReader();
    const chunk = await reader.read();
    assert.equal(
      new TextDecoder().decode(chunk.value),
      'event: log\ndata: {"text":"unchanged"}\n\n',
    );
    abort.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const calls = logs
      .split("\n")
      .filter((line) => line.startsWith("UPSTREAM_FIXTURE "))
      .map((line) => JSON.parse(line.slice("UPSTREAM_FIXTURE ".length)));
    assert.equal(calls.length, 10);
    assert.equal(
      calls[0].query,
      "?teamId=team_example&unknown=a%2Fb&repeat=1&repeat=2",
    );
    assert.equal(calls[1].query, "?resume=true");
    assert.equal(calls[0].artifactCi, "true");
    assert.equal(calls[0].artifactInteractive, "false");
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.equal(call.correctToken, true);
      assert.equal(call.methodOverride, false);
      assert.equal(call.redirect, "manual");
    }
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
});
