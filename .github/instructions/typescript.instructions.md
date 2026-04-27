---
applyTo: "packages/**/*.ts,packages/**/*.tsx,apps/cli/**/*.ts,apps/cli/**/*.tsx,**/package.json,pnpm-workspace.yaml,tsconfig*.json"
---

# TypeScript Workspace Review Instructions

This is a pnpm 10 ESM workspace using Node from `.nvmrc`, TypeScript, tsup, and
Vitest.

- Prefer workspace commands through Corepack. Use filtered commands for focused
  validation, such as `corepack pnpm --filter zitadel test`.
- Keep public SDK exports stable and deliberate. Changes to exported types,
  renderer props, or package entry points should include tests and README or
  contract updates when user-facing.
- `apps/cli`, `packages/sdk-core`, and `packages/sdk-next` are publishable npm
  packages and must keep `"license": "MIT"`.
- User-visible package changes need a changeset under `.changeset/`.
- Avoid committing generated `dist/**` churn unless the release or package smoke
  check explicitly requires it.
- Respect peer dependencies in `packages/sdk-next`; do not bundle React, Next,
  or React DOM into the SDK.
