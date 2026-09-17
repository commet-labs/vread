# vercel-read

A thin, authenticated **GET-only proxy** for the Vercel REST API, built with Next.js Route Handlers.

Change the API origin and use your service key. Keep Vercel's original paths and query parameters:

```sh
curl "$VERCEL_READ_URL/v9/projects/vercel-read?teamId=team_example" \
  -H "Authorization: Bearer $VERCEL_READ_API_KEY"
```

## Behavior

- Every GET path is forwarded to `https://api.vercel.com`, including paths not yet in the pinned documentation.
- POST, PUT, PATCH, DELETE, HEAD and OPTIONS return `405 Method Not Allowed` without reaching Vercel.
- Vercel receives its own server-held token; callers authenticate with a separate service key.
- Paths and query strings are preserved. No team injection, parameter validation, operation blocklist or response redaction.
- Upstream statuses and response bodies are preserved, including errors, redirects, binary data and live streams. No JSON reformatting, error envelopes, status remapping, snapshots or response-size cap is added by the application.
- Redirects are returned to the caller, never followed by the proxy.
- Transport headers and content encoding/length are managed by the HTTP runtime. Responses use `Cache-Control: private, no-store` so authenticated data cannot enter a shared cache.
- Request content negotiation, range, conditional and documented artifact-client headers are forwarded. Caller cookies, authorization, method-override and internal proxy headers are not forwarded.
- Only proxy authentication/configuration failures, rejected methods and connection failures produce proxy errors. Upstream Vercel errors pass through unchanged.

`GET /openapi.json` is the one reserved local endpoint. It documents the 167 GET operations in the pinned September 17, 2026 public Vercel specification, preserving native parameter and response schemas. Only the server URL and authentication scheme are changed. Other paths use Vercel directly.

## Configuration

Requires Node.js 24 and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

| Variable | Purpose |
| --- | --- |
| `VERCEL_READ_API_KEY` | Random service credential of at least 32 characters. |
| `VERCEL_UPSTREAM_TOKEN` | Dedicated Vercel token held only by this service. |

Generate the service credential with `openssl rand -hex 32`. The two keys must differ. Missing configuration fails closed. No OAuth is needed. Vercel permissions and plan limits still apply.

## Eve and other clients

All consumers use the same HTTP API. Eve can consume its OpenAPI document:

```ts
import { defineOpenAPIConnection } from "eve/connections";

export default defineOpenAPIConnection({
  spec: "https://YOUR-SERVICE/openapi.json",
  baseUrl: "https://YOUR-SERVICE",
  description: "GET requests to the Vercel API.",
  auth: {
    getToken: async () => {
      const token = process.env.VERCEL_READ_API_KEY;
      if (!token) throw new Error("VERCEL_READ_API_KEY is required");
      return { token };
    },
  },
});
```

Vercel paths remain unchanged for scripts, HTTP clients and agents. There is no MCP or separate agent implementation.

## Important scope

**GET-only does not mean free of side effects or secrets.** This intentionally includes environment/credential reads and Vercel's sandbox GET with `resume=true`, which can create a sandbox. The proxy enforces the HTTP method, not the semantics of upstream endpoints. Give its service key only to consumers trusted with everything accessible through GET using the upstream token. Never expose a deployment without authentication.

No response redaction is performed. Keep runtime administration and the upstream token out of agent sandboxes. Reads can incur upstream usage charges. See [SECURITY.md](SECURITY.md).

## Deploy

Import this repository into a Vercel project using the Next.js preset and Node.js 24. Set both variables as sensitive production secrets and deploy. Do not expose production credentials to untrusted preview builds. Git integration handles future deployments when connected. Rotate keys separately and redeploy as needed.

The application streams responses until completion or client cancellation; hosting-provider duration, payload and bandwidth limits still apply. The configured Vercel function duration is 300 seconds, subject to the plan's limits.

## Catalog and validation

`catalog/upstream.json` contains the pinned public GET specification, source URL, retrieval date and full original download SHA-256. Runtime forwarding does not depend on this catalog. After updating the snapshot, regenerate the documented GET surface:

```sh
pnpm catalog:generate
pnpm catalog:check
pnpm lint
pnpm test:unit
pnpm build
pnpm typecheck
pnpm test:e2e
```

Unit tests cover service authentication and fixed-origin URL construction. E2E tests exercise the real Next.js HTTP server with only the external Vercel transport simulated. They verify native errors, statuses, headers, bytes and streaming, GET forwarding without filters, and rejection of other methods. Tests never call Vercel; external networking is rejected by the fixture.

MIT. Independent project, not an official Vercel product. Vercel names and public API metadata belong to their respective owners. This repository remains private until explicitly authorized to publish.
