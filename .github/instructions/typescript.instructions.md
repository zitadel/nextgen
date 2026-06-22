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
- The public npm packages (`apps/cli`, `packages/api`, `packages/components`,
  `packages/sdk-core`, `packages/sdk-next`, `packages/sdk-nuxt`,
  `packages/sdk-react`, `packages/sdk-vue`, `packages/sdk-angular`,
  `packages/sdk-solid`, `packages/sdk-svelte`, `packages/sdk-qwik`) must keep
  `"license": "MIT"`.
- Follow the [decision table in `.changeset/README.md`](../../.changeset/README.md#decision-table)
  for publishable package paths; add a real changeset for user-visible changes,
  skip the file when the PR does not touch those paths. Write
  `.changeset/<slug>.md` directly rather than via the interactive prompt.
- PR descriptions for public package changes should state the changeset outcome
  and list the focused package validation commands that were actually run.
- Avoid committing generated `dist/**` churn unless the release or package smoke
  check explicitly requires it.
- Respect peer dependencies in `packages/sdk-next`; do not bundle React, Next,
  or React DOM into the SDK.
