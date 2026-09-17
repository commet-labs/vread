# vercel-read

One HTTP API for reading Vercel from scripts, people, and agents. Built with Next.js Route Handlers. It wraps the **Vercel REST API**, not the CLI or MCP.

The service holds one upstream Vercel token. Clients receive a separate service key and can invoke only the operations in a reviewed, versioned catalog. They cannot supply arbitrary URLs, HTTP methods, upstream headers, team IDs, or credentials.

## Use

```sh
curl "$VERCEL_READ_URL/api/getProject?idOrName=vercel-read" \
  -H "Authorization: Bearer $VERCEL_READ_API_KEY"

curl "$VERCEL_READ_URL/api/getDeployments?projectId=prj_example&limit=10" \
  -H "Authorization: Bearer $VERCEL_READ_API_KEY"
```

Endpoints use Vercel's `operationId`. Both upstream path parameters and query parameters become query parameters on this API. Team and owner parameters are supplied by the server. Sandbox `resume` is forced to false and cannot be supplied by clients. Use IDs instead of URL-encoded paths or slash-containing names.

- `GET /openapi.json`: public OpenAPI 3.0 contract for enabled operations.
- `GET /operations`: public inventory of enabled and blocked reads, with reasons.
- `GET /health`: process liveness, not proof that upstream credentials work.
- `GET /api/{operationId}`: a reviewed upstream GET or HEAD operation.
- `POST /api/{operationId}`: only an explicitly reviewed JSON read query.

GET operations reject POST, PUT, PATCH, DELETE, HEAD and OPTIONS. Public GET operations wrapping upstream HEAD return JSON status metadata. Five upstream POST queries are allowed: artifact metadata, bulk domain pricing, bulk domain availability, domain search, and observability queries. No deploy, purchase, update, delete, token minting, command execution, or generic HTTP proxy operation exists.

```sh
curl "$VERCEL_READ_URL/api/getBulkAvailability" \
  -H "Authorization: Bearer $VERCEL_READ_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"domains":["example.com"]}'
```

Observability queries use the configured team automatically; clients cannot submit `scope`. Ordinary pagination parameters are preserved. Responses omit credential-bearing fields, so they are not byte-for-byte copies of Vercel's responses.

## Coverage

The pinned public [Vercel OpenAPI catalog](https://openapi.vercel.sh/) was retrieved on September 17, 2026. All 171 GET/HEAD operations and six POST reads have an explicit decision: **162 enabled, 15 blocked**. See `/operations` or [catalog/policy.json](catalog/policy.json).

“All reads” does not mean exporting credentials. Decrypted environment variables, config contents/backups, bearer-token lists, domain transfer authorization codes, sandbox files, deployment source files, and binary artifact/image downloads are deliberately unavailable. Reading them could hand a caller the capability to write elsewhere. This service never downloads environment variables.

Reads still depend on the upstream token's permissions, Vercel plan, endpoint availability and rate limits. The catalog covers the public REST snapshot, not undocumented dashboard APIs. It does not claim a live success check for every endpoint. Streaming logs are returned as five-second bounded JSON snapshots. `X-Vercel-Read-Stream-Complete: false` marks a snapshot cut short by the time or size limit; incomplete trailing records are omitted. Binary responses are rejected. Queries must complete within 45 seconds and return at most 2 MiB; JSON request bodies are limited to 64 KiB and URLs to 8 KiB. Narrow queries and paginate large results.

## Run locally

Requires Node.js 24 and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Set these values privately, never in source control:

| Variable | Purpose |
| --- | --- |
| `VERCEL_READ_API_KEY` | A random service credential of at least 32 characters, shared only with authorized consumers. |
| `VERCEL_UPSTREAM_TOKEN` | Your Vercel API token, held exclusively by the service. Use a dedicated token scoped to the intended team. |
| `VERCEL_TEAM_ID` | The fixed `team_...` identifier. Clients cannot override it. |
| `VERCEL_TEAM_SLUG` | The matching team slug, required for container-registry path operations. |

Generate a service credential with `openssl rand -hex 32`. It must differ from the upstream token. Missing configuration fails closed. OAuth is not required. Do not distribute the upstream token to consumers.

## Eve and other clients

All clients use this same API. An Eve connection can consume the published contract:

```ts
import { defineOpenAPIConnection } from "eve/connections";

export default defineOpenAPIConnection({
  spec: "https://YOUR-SERVICE/openapi.json",
  baseUrl: "https://YOUR-SERVICE",
  description: "Read Vercel project, deployment, log and account metadata.",
  auth: {
    getToken: async () => {
      const token = process.env.VERCEL_READ_API_KEY;
      if (!token) throw new Error("VERCEL_READ_API_KEY is required");
      return { token };
    },
  },
});
```

Eve, Codex, shell scripts and other HTTP clients receive only the service key. No second implementation or new MCP is needed. Client connections are not installed automatically.

## Deploy

Import this repository into a **new** Vercel project with the Next.js preset and Node.js 24. Configure the four variables for production, keeping the two credentials as sensitive secrets, then deploy. Use the Git integration for future deployments. Production API clients use the service bearer key; Vercel preview protection can remain enabled.

Do not give agents repository write access, deployment privileges, environment access, or an administrative Vercel credential for this service. Otherwise they can modify the policy or obtain its token. Configure upstream credentials only in trusted environments; do not expose production secrets to untrusted pull-request previews. Rotate the service key and redeploy to revoke client access. Rotate the upstream token separately when it expires or is exposed.

## Security boundary

The enforced boundary is the operation catalog and request builder in this service, not a prompt or a read-only flag on a full-access Vercel token. The token itself may retain write permissions. Only reviewed read methods reach a fixed HTTPS origin, redirects are not followed, incoming headers are never forwarded, and errors do not disclose upstream response bodies.

Secret fields and known credential patterns are removed recursively. **Redaction cannot prove arbitrary application logs contain no unknown secrets.** Treat logs and returned business data as sensitive, keep secrets out of logs, and restrict service access accordingly. This software cannot protect against a compromised service administrator, an upstream endpoint changing behavior, or a framework vulnerability. See [SECURITY.md](SECURITY.md).

## Maintain the catalog

[catalog/upstream.json](catalog/upstream.json) stores normalized operation/input metadata plus the source SHA-256, URL and retrieval date. Response schemas are intentionally not copied because responses are projected. Runtime never downloads a changing upstream specification.

Review upstream changes before editing the snapshot. Add an explicit `read` or `blocked` decision with a reason in `catalog/policy.json`, then run:

```sh
pnpm catalog:generate
pnpm catalog:check
```

New GET/HEAD operations without a decision fail generation; new POST operations are unavailable until explicitly reviewed. Mutation operations must never be added to the read policy. Generated files are committed, and CI rejects drift.

## Validate

```sh
pnpm catalog:check
pnpm lint
pnpm test:unit
pnpm build
pnpm typecheck
pnpm test:e2e
```

Unit tests exercise real pure authorization, request-building and redaction decisions. HTTP E2E tests start the real production Next.js server and substitute only the external Vercel transport with a deterministic fixture. They verify rejected calls never reach upstream, valid requests carry only the upstream key, and redirects/secrets are blocked. These tests do not contact Vercel or require credentials. Live smoke tests must target a specifically authorized project and never issue mutations to test rejection.

## License

MIT. This is an independent project, not an official Vercel product. Vercel names and marks belong to their owners. Public API metadata comes from the linked upstream specification. The repository is initially private; changing its visibility requires explicit maintainer approval.
