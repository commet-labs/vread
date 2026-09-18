# Security policy

Report vulnerabilities privately to repository maintainers. Never include live credentials in an issue.

## Contract

This service forwards authenticated GET requests to the fixed origin `https://api.vercel.com`. All other methods are rejected. Caller authorization is replaced with the server-held upstream token, redirects are not followed, and shared caching is disabled.

The optional server-owned access-policy.ts allowlist limits exact catalog operations and is disabled by default. It does not scope projects, teams or query variants, or redact responses. Unknown routes and versions are denied when enabled. GET endpoints can expose secrets or have side effects: Vercel's named-sandbox GET with `resume=true` can create a sandbox. The service is a GET-only proxy, not a semantic read-only authorization boundary. The service key must be treated as granting all GET capabilities of the upstream token.

Response bodies and Vercel errors pass through unchanged. Arbitrary returned credentials can grant access outside this service. Applications must decide whether consumers are trusted with those capabilities.

## Operator responsibilities

Use a dedicated appropriately scoped upstream token and a different high-entropy service key. Keep both out of source control, and withhold production credentials from untrusted previews. Service administrators can change its code and credentials; they are outside the constrained HTTP-client boundary.

Configure provider-level rate limiting, spending controls and dependency updates appropriate to the deployment. The proxy's method restriction does not prevent denial of service, usage charges, secret reads, upstream GET side effects or actions made with an independently obtained credential.

Tests use a local server and an external-transport fixture. Do not probe live mutation behavior or query other projects without authorization.
