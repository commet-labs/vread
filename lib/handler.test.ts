import assert from "node:assert/strict";
import test from "node:test";
import { authenticate, upstreamUrl } from "./handler";

test("authentication requires the exact service bearer credential", () => {
  const key = "vercel_read_test_key_longer_than_32_characters";
  assert.equal(authenticate(`Bearer ${key}`, key), true);
  for (const header of [
    null,
    key,
    `Basic ${key}`,
    `Bearer ${key} `,
    `Bearer ${key.slice(1)}`,
  ])
    assert.equal(authenticate(header, key), false);
});

test("upstream origin is fixed while path and query remain native", () => {
  for (const suffix of [
    "/v9/projects/prj_example?teamId=team_one&x=1&x=2",
    "/v2/sandboxes/example?resume=true",
    "/v1/projects/prj_example/env/env_example",
    "/undocumented?encoded=a%2Fb",
    "//attacker.invalid/path",
  ]) {
    const request = new URL(`http://localhost:3000${suffix}`);
    const upstream = upstreamUrl(request.href);
    assert.equal(upstream.origin, "https://api.vercel.com");
    assert.equal(upstream.pathname, request.pathname);
    assert.equal(upstream.search, request.search);
    assert.equal(upstream.username, "");
    assert.equal(upstream.password, "");
  }
});
