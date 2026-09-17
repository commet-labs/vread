# VRead

Self-host a GET-only proxy for the Vercel REST API. Give your scripts and agents one service URL and key while keeping your Vercel token on your server. No database, OAuth flow, dashboard or separate MCP server is required.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcommet-labs%2Fvread&project-name=vread&repository-name=vread&env=VREAD_API_KEY,VREAD_UPSTREAM_TOKEN&envDescription=Use%20a%20random%20service%20key%20and%20a%20different%20Vercel%20token.&envLink=https%3A%2F%2Fgithub.com%2Fcommet-labs%2Fvread%23configuration)

## Configuration

Every installation uses its own two secrets. Neither is needed to build the application.

| Variable | Purpose |
| --- | --- |
| `VREAD_API_KEY` | Your random service key, at least 32 characters. Give this to clients. |
| `VREAD_UPSTREAM_TOKEN` | Your Vercel access token. Keep this only on the server. |

Generate a service key with `openssl rand -hex 32`. Create a dedicated [Vercel access token](https://vercel.com/account/settings/tokens) with the scope you need. The keys must differ. Vercel permissions and plan limits still apply. Use these VREAD-prefixed names in both your hosting settings and clients. If updating an earlier installation, rename its two environment variables before restarting.

## Deploy to Vercel

1. Click **Deploy with Vercel** above to create your own repository and project.
2. Enter both secrets when prompted. The button includes variable names only, never secret values.
3. Deploy using the Next.js preset and Node.js 24, then use the deployment URL in your client.

You can also import your fork manually. Set both secrets in the production environment and keep them out of untrusted preview builds. If deployment protection is enabled, configure machine access separately; VRead's bearer key does not bypass Vercel deployment protection.

The configured function duration is 300 seconds, subject to your plan. Hosting duration, payload and bandwidth limits apply to streaming too. See Vercel's [Deploy Button documentation](https://vercel.com/docs/deploy-button) and [environment variable parameters](https://vercel.com/docs/deploy-button/environment-variables).

## Deploy on your own server

Requires Node.js 24 and pnpm 10.32.1. No Vercel hosting account integration or CLI is needed; only your upstream API token is required.

```sh
git clone https://github.com/commet-labs/vread.git
cd vread
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env.local
chmod 600 .env.local
```

Fill in both values in `.env.local` with your editor. Never commit this file. Then prepare and run the standalone server:

```sh
cp -R .next/static .next/standalone/.next/static
NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000 \
  node --env-file=.env.local .next/standalone/server.js
```

Keep the process running with your server's process manager, using the repository directory as its working directory and the same command/environment. Put an HTTPS reverse proxy in front of `127.0.0.1:3000`. Preserve the request path, query and Authorization header, disable response caching and buffering, and choose a read timeout appropriate for long-lived streams. Never log Authorization headers or response bodies.

Example Nginx location inside your HTTPS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
```

For process readiness, use `GET /openapi.json`; it requires no key and does not contact Vercel. This checks that VRead is running, not that the upstream token is valid. HEAD probes return 405. To verify authentication without contacting Vercel, an unauthenticated `GET /v9/projects` should return 401.

To update, pull your chosen revision, install with the frozen lockfile, rebuild, copy static assets again and restart the process. Restart after rotating either secret. For isolated releases, build in a new directory before switching your process manager to it. See the [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

## Use your instance

Set `VREAD_URL` to your instance's HTTPS origin and `VREAD_API_KEY` to its service key in your client environment:

```sh
curl "$VREAD_URL/v9/projects?teamId=team_example" \
  -H "Authorization: Bearer $VREAD_API_KEY"
```

Keep Vercel's original paths, versions and query parameters. VRead does not pin you to v9. Omit or change `teamId` as appropriate for your token. A POST, PUT, PATCH, DELETE, HEAD or OPTIONS request returns 405 without reaching Vercel.

Agents and OpenAPI clients can use `https://YOUR-INSTANCE/openapi.json` with your instance origin as their base URL and your service key as bearer authentication. All clients use this one HTTP API.

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

## Scope

**GET-only does not mean free of side effects or secrets.** VRead intentionally includes environment/credential reads and sandbox GETs with `resume=true`, which can create a sandbox. There is no response redaction. Share your service key only with consumers trusted with all GET capabilities of your upstream token. Reads may incur usage charges. See [SECURITY.md](SECURITY.md).

## Local development

After installing dependencies and filling `.env.local`, run `pnpm dev`. Development uses the same credentials and upstream as production, so use a dedicated development token.

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

MIT. Independent project, not an official Vercel product. Vercel names and public API metadata belong to their respective owners.
