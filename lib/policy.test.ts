import assert from "node:assert/strict";
import test from "node:test";
import catalog from "../catalog/operations.json";
import {
  authenticate,
  buildUpstreamRequest,
  RequestError,
  resolveOperation,
} from "./policy";
import { redact } from "./redaction";

const teamId = "team_test";
const key = "vercel_read_test_key_with_more_than_32_characters";

test("service authentication accepts only the exact bearer credential", () => {
  assert.equal(authenticate(`Bearer ${key}`, key), true);
  for (const header of [
    null,
    key,
    `Basic ${key}`,
    `Bearer ${key} `,
    `Bearer ${key.slice(1)}`,
    `Bearer ${"a".repeat(1000)}`,
  ])
    assert.equal(authenticate(header, key), false);
});

test("only reviewed reads are callable and methods cannot be changed", () => {
  for (const operation of catalog) {
    const method = operation.method === "POST" ? "POST" : "GET";
    if (operation.access === "blocked")
      assert.throws(
        () => resolveOperation(operation.operationId, method),
        (error: unknown) =>
          error instanceof RequestError && error.status === 403,
      );
    else {
      assert.equal(
        resolveOperation(operation.operationId, method).operationId,
        operation.operationId,
      );
      for (const mutationMethod of [
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "HEAD",
      ])
        assert.throws(
          () => resolveOperation(operation.operationId, mutationMethod),
          (error: unknown) =>
            error instanceof RequestError && error.status === 405,
        );
    }
  }
  for (const name of [
    "deleteProject",
    "createDeployment",
    "getConnectorToken",
    "__proto__",
    "constructor",
    "toString",
  ])
    assert.throws(
      () => resolveOperation(name, "POST"),
      (error: unknown) => error instanceof RequestError && error.status === 404,
    );
});

test("every enabled input schema compiles and rejects missing required input without internal errors", () => {
  for (const operation of catalog.filter((item) => item.access === "read")) {
    const read = resolveOperation(
      operation.operationId,
      operation.method === "POST" ? "POST" : "GET",
    );
    try {
      buildUpstreamRequest(read, new URLSearchParams(), undefined, teamId);
    } catch (error) {
      assert.ok(
        error instanceof RequestError,
        `${operation.operationId}: ${String(error)}`,
      );
    }
  }
});

test("project reads pin origin, method, team and encoded resource path", () => {
  const operation = resolveOperation("getProject", "GET");
  const request = buildUpstreamRequest(
    operation,
    new URLSearchParams({ idOrName: "vercel-read" }),
    undefined,
    teamId,
  );
  assert.equal(
    request.url.href,
    "https://api.vercel.com/v9/projects/vercel-read?teamId=team_test",
  );
  assert.equal(request.body, undefined);
  const team = buildUpstreamRequest(
    resolveOperation("getTeam", "GET"),
    new URLSearchParams(),
    undefined,
    teamId,
  );
  assert.equal(team.url.pathname, `/v2/teams/${teamId}`);
});

test("path traversal, escaping, unknown parameters and scope overrides are rejected", () => {
  const operation = resolveOperation("getProject", "GET");
  for (const value of [
    "..",
    ".",
    "../user/tokens",
    "%2e%2e",
    "foo/bar",
    "foo\\bar",
    "//evil.example",
    "foo?decrypt=true",
    "foo#fragment",
    "a\n",
  ])
    assert.throws(
      () =>
        buildUpstreamRequest(
          operation,
          new URLSearchParams({ idOrName: value }),
          undefined,
          teamId,
        ),
      RequestError,
    );
  for (const name of [
    "teamId",
    "slug",
    "decrypt",
    "url",
    "method",
    "__proto__",
    "authorization",
  ])
    assert.throws(
      () =>
        buildUpstreamRequest(
          operation,
          new URLSearchParams({
            idOrName: "vercel-read",
            [name]: "unexpected",
          }),
          undefined,
          teamId,
        ),
      RequestError,
    );
  assert.throws(
    () =>
      buildUpstreamRequest(
        operation,
        new URLSearchParams("idOrName=a&idOrName=b"),
        undefined,
        teamId,
      ),
    RequestError,
  );
  assert.throws(
    () =>
      buildUpstreamRequest(
        operation,
        new URLSearchParams("idOrName=a"),
        { method: "DELETE" },
        teamId,
      ),
    RequestError,
  );
});

test("reviewed POST queries validate bodies and force observability owner scope", () => {
  const query = resolveOperation("createObservabilityQuery", "POST");
  const request = buildUpstreamRequest(
    query,
    new URLSearchParams(),
    { metric: "requests" },
    teamId,
  );
  assert.deepEqual(JSON.parse(request.body as string), {
    metric: "requests",
    scope: { type: "team", ownerId: teamId },
  });
  assert.throws(
    () =>
      buildUpstreamRequest(
        query,
        new URLSearchParams(),
        { metric: "requests", scope: { ownerId: "team_other" } },
        teamId,
      ),
    RequestError,
  );
  assert.throws(
    () =>
      buildUpstreamRequest(
        query,
        new URLSearchParams(),
        { metric: "requests", unexpected: true },
        teamId,
      ),
    RequestError,
  );
  assert.throws(
    () =>
      buildUpstreamRequest(
        resolveOperation("getBulkPrice", "POST"),
        new URLSearchParams(),
        { domains: [] },
        teamId,
      ),
    RequestError,
  );
});

test("secret fields, containers and embedded known credentials never survive projection", () => {
  const secret = "the_upstream_secret_value";
  const input = {
    id: "prj_test",
    env: { ANY_NAME: "sensitive" },
    build: { env: ["sensitive"] },
    protectionBypass: { bypass: {} },
    secret: "sensitive",
    headers: { Authorization: "sensitive" },
    token: { value: "sensitive" },
    nested: [
      {
        api_key: "sensitive",
        text: `value=${secret} Bearer abcdef vca_testcredential`,
      },
    ],
    encoded: Buffer.from(secret).toString("base64"),
    url: "https://user:pass@example.com/path?token=secret",
    [secret]: secret,
  };
  const output = redact(input, [secret]);
  const encoded = JSON.stringify(output);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes("sensitive"), false);
  assert.equal(encoded.includes("abcdef"), false);
  assert.equal(encoded.includes("vca_testcredential"), false);
  assert.equal(encoded.includes("user:pass"), false);
  assert.ok(encoded.includes('"id":"prj_test"'));
});

test("sandbox reads cannot resume workloads and owner selectors are server-owned", () => {
  const sandbox = resolveOperation("getNamedSandbox", "GET");
  assert.throws(
    () =>
      buildUpstreamRequest(
        sandbox,
        new URLSearchParams({ name: "test", resume: "true" }),
        undefined,
        teamId,
      ),
    RequestError,
  );
  assert.throws(
    () =>
      buildUpstreamRequest(
        sandbox,
        new URLSearchParams({ name: "test", resume: "false" }),
        undefined,
        teamId,
      ),
    RequestError,
  );
  assert.equal(
    buildUpstreamRequest(
      sandbox,
      new URLSearchParams({ name: "test" }),
      undefined,
      teamId,
    ).url.searchParams.get("resume"),
    "false",
  );
  const virtualModel = resolveOperation(
    "getAiGatewayVirtualModelConfig",
    "GET",
  );
  assert.throws(
    () =>
      buildUpstreamRequest(
        virtualModel,
        new URLSearchParams({ ownerId: "team_other" }),
        undefined,
        teamId,
      ),
    RequestError,
  );
  assert.equal(
    buildUpstreamRequest(
      virtualModel,
      new URLSearchParams(),
      undefined,
      teamId,
    ).url.searchParams.get("ownerId"),
    teamId,
  );
});

test("wire query values preserve string-number unions and validate numeric scalars", () => {
  const repositories = resolveOperation("searchRepo", "GET");
  assert.equal(
    buildUpstreamRequest(
      repositories,
      new URLSearchParams({ namespaceId: "123", provider: "github" }),
      undefined,
      teamId,
    ).url.searchParams.get("namespaceId"),
    "123",
  );
  const deployments = resolveOperation("getDeployments", "GET");
  assert.equal(
    buildUpstreamRequest(
      deployments,
      new URLSearchParams({ limit: "10" }),
      undefined,
      teamId,
    ).url.searchParams.get("limit"),
    "10",
  );
  for (const limit of ["", "NaN", "Infinity", "abc"])
    assert.throws(
      () =>
        buildUpstreamRequest(
          deployments,
          new URLSearchParams({ limit }),
          undefined,
          teamId,
        ),
      RequestError,
    );
});
