import assert from "node:assert/strict";
import test from "node:test";
import { createAccessPolicy } from "./access-policy";

const url = (path: string) => new URL(`https://api.vercel.com${path}`);

test("disabled policy preserves unrestricted GET paths", () => {
  const policy = createAccessPolicy({ enabled: false, allowedOperations: [] });
  assert.equal(policy.allows(url("/undocumented?decrypt=true")), true);
  assert.equal(policy.allows(url("/v2/sandboxes/example?resume=true")), true);
});

test("enabled policy allows exact documented operations and preserves queries", () => {
  const policy = createAccessPolicy({
    enabled: true,
    allowedOperations: ["getProjects", "getDeployment"],
  });
  assert.equal(
    policy.allows(url("/v10/projects?teamId=example&limit=1")),
    true,
  );
  assert.equal(
    policy.allows(url("/v13/deployments/dpl_example?unknown=1")),
    true,
  );
  for (const path of [
    "/v9/projects",
    "/v1/projects/project/env/secret",
    "/v13/deployments/dpl_example/events",
    "/undocumented",
    "/v13/deployments/a%2fb",
    "/v13/deployments/a%252fb",
    "/v13/deployments/a%5cb",
    "/v13/deployments/%zz",
  ])
    assert.equal(policy.allows(url(path)), false, path);
  assert.deepEqual(Object.keys(policy.specification.paths).sort(), [
    "/v10/projects",
    "/v13/deployments/{idOrUrl}",
  ]);
});

test("static routes cannot inherit permission from parameter routes", () => {
  const policy = createAccessPolicy({
    enabled: true,
    allowedOperations: ["getNamedSandbox"],
  });
  assert.equal(policy.allows(url("/v2/sandboxes/example")), true);
  assert.equal(policy.allows(url("/v2/sandboxes/sessions")), false);
  assert.equal(policy.allows(url("/v2/sandboxes/%73essions")), false);
});

test("empty allowlist denies everything and invalid operation IDs fail closed", () => {
  const policy = createAccessPolicy({ enabled: true, allowedOperations: [] });
  assert.equal(policy.allows(url("/v10/projects")), false);
  assert.deepEqual(policy.specification.paths, {});
  assert.throws(() =>
    createAccessPolicy({ enabled: true, allowedOperations: ["getProjectz"] }),
  );
});
