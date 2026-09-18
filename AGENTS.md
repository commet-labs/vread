# VRead

One thin Next.js HTTP proxy for the Vercel REST API.

## Contract

- Forward authenticated GET requests to the fixed api.vercel.com origin. The code-configured operation allowlist is disabled by default; when enabled, deny unlisted routes before fetching and expose only allowed operations in OpenAPI.
- Preserve native paths, query strings, upstream statuses, errors, response bodies and streams.
- Reject every other HTTP method, including HEAD and OPTIONS.
- Do not add operation blocklists, parameter policies, response redaction, error rewriting or snapshot conversion without explicit user authorization.
- Keep the upstream credential server-side; callers use a separate service key.
- GET can expose secrets and trigger upstream side effects. Never describe this as a semantic read-only guarantee.
- Do not access Vercel or other projects unless the human restores authorization. Current work is local and GitHub only.

## Delivery

Use Node.js 24 and pnpm. Run catalog:check, lint, test:unit, build, typecheck and test:e2e. HTTP E2E uses the real Next.js server with only external Vercel simulated and no external network calls.

Use conventional commits, English artifacts and no AI attribution. The repository is public and MIT licensed. Never commit secrets or deployment-specific configuration.
