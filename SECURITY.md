# Security policy

Report suspected vulnerabilities privately through GitHub private vulnerability reporting. Do not open a public issue containing credentials or exploit details against a live deployment.

## Intended boundary

An authenticated API consumer can invoke reviewed read operations. It cannot choose an upstream destination, use a mutation method, forward arbitrary headers, request decryption, or obtain a raw upstream token from the service configuration. Unknown and blocked operations fail before an upstream request. The upstream token and source/deployment administration are outside the consumer's trust boundary.

This is not an account-wide read-only credential. A user with independent Vercel access can act outside this service. An agent with repository write access, deployment access, or filesystem/environment access to the host is an administrator, not a constrained consumer.

## Data handling

The service does not persist upstream results. Responses are private and non-cacheable. Application audit events include a request ID, operation ID, method and upstream status only, not credentials, bodies or query values. Infrastructure may record request URLs: never place the service key or sensitive values in query parameters.

Explicit credential-export and raw-file operations are denied. Remaining JSON fields are redacted by field name, known token patterns and the exact active credentials. This is defense in depth, not a guarantee that arbitrary application-provided text is free of secrets. Logs can contain sensitive data in unknown formats. Review the needs and trust of every client.

## Deployment requirements

- Dedicated team-scoped Vercel token; do not reuse a human's unrestricted CLI credential.
- Different, high-entropy service key with at least 32 characters.
- Production secrets withheld from untrusted preview builds and pull requests.
- Trusted maintainers only for service configuration, Git pushes and deployment.
- Platform-level rate limiting and spending controls suited to the installation. Reads can consume paid Vercel usage; read-only is not cost-free.
- Keep dependencies updated. Review each catalog update; upstream GET semantics are not independently enforceable by this service.

When investigating a report, do not send mutation requests to production Vercel. Reproduce through the local HTTP test boundary and external fixture first.
