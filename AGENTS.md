# vercel-read

One shared HTTP service wrapping the public Vercel REST API. No CLI execution or MCP server.

## Security contract

- Only explicitly reviewed catalog operations can reach the fixed upstream origin.
- Never expose upstream credentials, environment variables, arbitrary URLs, forwarded client headers, or mutation operations.
- New upstream operations remain unavailable until reviewed in catalog/policy.json.
- Never add an unsafe mode, generic proxy, decryption option, or agent-controlled destination.
- Runtime credentials stay out of agent sandboxes. Service administrators remain trusted.
- Changes that broaden access require security review and tests through the HTTP boundary.
- Tests and smoke checks must target only the vercel-read Vercel project unless the human explicitly authorizes another project.

## Development

Use Node.js 24 and pnpm. Run `pnpm catalog:check`, `pnpm lint`, `pnpm test:unit`, `pnpm build`, `pnpm typecheck`, and `pnpm test:e2e` before delivery. Unit tests protect pure policy decisions. E2E tests use the real Next.js HTTP server; never test mutation rejection against Vercel itself.

Use conventional commits, English artifacts, and no AI attribution. Keep the GitHub repository private until explicitly authorized to publish it.
