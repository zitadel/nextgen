---
applyTo: "packages/**/*.ts,packages/**/*.tsx,apps/**/*.ts,apps/**/*.tsx,**/package.json,pnpm-workspace.yaml,tsconfig*.json"
---

# TypeScript Workspace Review Instructions

This is a pnpm ESM workspace using Node from `.nvmrc`, the pnpm version from
`package.json#packageManager`, TypeScript, tsdown/Vite builds, and Vitest.
Canonical scoped sources: [`packages/AGENTS.md`](../../packages/AGENTS.md)
(SDK export stability, peer-dependency rules, the mixed build tooling and why),
plus the per-package `AGENTS.md` files (components, design-tokens,
testing, api-mock) and
[`apps/console/AGENTS.md`](../../apps/console/AGENTS.md) for console UI.
Review pointers on top:

- Prefer Moon tasks for focused validation (`moon run <project>:<task>`, e.g.
  `moon run cli:test`); packages are addressed by their `@zitadel/*` names in
  filtered pnpm commands.
- Keep public SDK exports stable and deliberate; user-facing changes need
  tests plus README/contract updates
  ([`packages/AGENTS.md`](../../packages/AGENTS.md)).
- Licensing: published packages under `apps/cli` and the published
  `packages/*` keep `"license": "MIT"`; `apps/server*` are `AGPL-3.0-only`;
  several `packages/*` are private and unpublished — see
  [`LICENSING.md`](../../LICENSING.md).
- Changesets: follow the
  [decision table](../../.changeset/README.md#decision-table); write
  `.changeset/<slug>.md` directly.
- Avoid committing generated `dist/**` churn unless the release or package
  smoke check explicitly requires it.
