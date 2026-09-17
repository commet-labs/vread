import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiKey = "vercel_read_e2e_key_longer_than_32_characters";
const authorization = `Bearer ${apiKey}`;

test("Next.js HTTP boundary enforces read-only access and isolates upstream credentials", async () => {
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
        VERCEL_READ_API_KEY: apiKey,
        VERCEL_UPSTREAM_TOKEN: "upstream_fixture_credential",
        VERCEL_TEAM_ID: "team_fixture",
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
        ready = (await fetch(`${origin}/health`)).ok;
      } catch {}
      if (ready) break;
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    const spec = await (await fetch(`${origin}/openapi.json`)).json();
    assert.equal(spec.info.title, "vercel-read");
    assert.equal(Object.hasOwn(spec.paths, "/api/deleteProject"), false);
    assert.equal(Object.hasOwn(spec.paths, "/api/getProjectEnv"), false);
    assert.equal(
      (await fetch(`${origin}/api/getProject?idOrName=vercel-read`)).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/getProject?idOrName=vercel-read`, {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
      assert.equal(
        (
          await fetch(`${origin}/api/getProject?idOrName=vercel-read`, {
            method,
            headers: { authorization },
          })
        ).status,
        405,
      );
    for (const name of [
      "deleteProject",
      "createDeployment",
      "getConnectorToken",
      "constructor",
    ])
      assert.equal(
        (
          await fetch(`${origin}/api/${name}`, {
            method: "POST",
            headers: { authorization },
          })
        ).status,
        404,
      );
    assert.equal(
      (
        await fetch(`${origin}/api/getProjectEnv`, {
          headers: { authorization },
        })
      ).status,
      403,
    );
    for (const query of [
      "idOrName=..",
      "idOrName=%252e%252e",
      "idOrName=a%2Fb",
      "idOrName=a&teamId=team_other",
      "idOrName=a&decrypt=true",
      "idOrName=a&idOrName=b",
    ])
      assert.equal(
        (
          await fetch(`${origin}/api/getProject?${query}`, {
            headers: { authorization },
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await fetch(`${origin}/api/getNamedSandbox?name=test&resume=true`, {
          headers: { authorization },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(
          `${origin}/api/getAiGatewayVirtualModelConfig?ownerId=team_other`,
          { headers: { authorization } },
        )
      ).status,
      400,
    );
    assert.equal(
      logs.includes("UPSTREAM_FIXTURE"),
      false,
      "Denied requests must never reach upstream",
    );
    const response = await fetch(
      `${origin}/api/getProject?idOrName=vercel-read`,
      {
        headers: {
          authorization,
          "x-client-injection": "unsafe",
          "x-http-method-override": "DELETE",
        },
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") as string, /no-store/);
    assert.deepEqual(await response.json(), {
      id: "prj_fixture",
      name: "vercel-read",
      nested: { text: "[REDACTED]" },
    });
    const query = await fetch(`${origin}/api/createObservabilityQuery`, {
      method: "POST",
      headers: { authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ metric: "requests" }),
    });
    assert.equal(query.status, 200);
    for (const [id, status] of [
      ["redirect", 502],
      ["upstream-error", 403],
      ["binary", 502],
      ["large", 502],
    ] as const) {
      const result = await fetch(`${origin}/api/getProject?idOrName=${id}`, {
        headers: { authorization },
      });
      assert.equal(result.status, status);
      assert.equal(
        (await result.text()).includes("upstream_fixture_credential"),
        false,
      );
    }
    const events = await fetch(
      `${origin}/api/getDeploymentEvents?idOrUrl=dpl_fixture`,
      { headers: { authorization } },
    );
    assert.deepEqual(await events.json(), [
      { text: "Bearer [REDACTED]" },
      { text: "build complete" },
    ]);
    const live = await fetch(
      `${origin}/api/getRuntimeLogs?projectId=prj_fixture&deploymentId=dpl_fixture`,
      { headers: { authorization } },
    );
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("x-vercel-read-stream-complete"), "false");
    assert.deepEqual(await live.json(), [{ message: "Bearer [REDACTED]" }]);
    assert.equal(
      (
        await fetch(`${origin}/api/getNamedSandbox?name=test`, {
          headers: { authorization },
        })
      ).status,
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const calls = logs
      .split("\n")
      .filter((line) => line.startsWith("UPSTREAM_FIXTURE "))
      .map((line) => JSON.parse(line.slice("UPSTREAM_FIXTURE ".length)));
    assert.equal(calls.length, 9);
    assert.equal(calls.at(-1).resume, "false");
    for (const call of calls) {
      assert.equal(call.teamId, "team_fixture");
      assert.equal(call.correctToken, true);
      assert.equal(call.clientHeader, false);
      assert.equal(call.redirect, "manual");
      assert.ok(["GET", "POST"].includes(call.method));
    }
    assert.deepEqual(JSON.parse(calls[1].body).scope, {
      type: "team",
      ownerId: "team_fixture",
    });
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
});
