---
applyTo: "packages/**/*.ts,packages/**/*.tsx,apps/**/*.ts,apps/**/*.tsx,**/package.json,pnpm-workspace.yaml,tsconfig*.json"
---

# TypeScript Workspace Review Instructions

Canonical scoped sources: [`packages/AGENTS.md`](../../packages/AGENTS.md) for
the SDKs, each package's own `AGENTS.md`, and
[`apps/console/AGENTS.md`](../../apps/console/AGENTS.md) for console UI.
Review heuristics on top:

- Keep public SDK exports stable and deliberate; user-facing changes need tests
  plus README or contract updates.
- A package's `license` field and `LICENSE` file must match
  [`LICENSING.md`](../../LICENSING.md) for its path.
- Changesets follow the
  [decision table](../../.changeset/README.md#decision-table); write
  `.changeset/<slug>.md` directly.
- Avoid committing generated `dist/**` churn unless the release or package
  smoke check explicitly requires it.
