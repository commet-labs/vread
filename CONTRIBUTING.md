# Contributing

Use Node.js 24 and the pinned pnpm version. Follow AGENTS.md and run the complete validation commands in README.md before submitting a change.

Changes to the operation catalog, parameter validation, response projection, authentication or upstream transport must include regression tests at the affected boundary. Explain which read capability changes and why it cannot perform a write. Never add a generic URL fetcher, unsafe mode, secret-export option or fallback to an unreviewed API operation.

Use conventional commits. Keep source, documentation and tests in English. Never commit credentials, local environment files, deployment output or customer data. The repository remains private until maintainers explicitly authorize publication.
