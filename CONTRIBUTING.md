# Contributing

## Start with an issue

We review pull requests only for issues a maintainer has approved. Open an issue first; if we agree on the change, a maintainer assigns it to you, and you can then open a pull request that references it with `Closes #<issue number>`. Pull requests without a referenced issue assigned to their author are closed automatically.

Use Node.js 24 and the pinned pnpm version. Follow AGENTS.md and run the README validation commands before submitting changes.

Preserve the thin GET-only proxy contract. Tests should prove native HTTP behavior and method/authentication enforcement. Do not add opinionated transformations, endpoint exclusions or another agent-specific implementation without maintainer approval.

Use conventional commits and English artifacts. Never commit credentials, environment files, deployment output or customer data.
