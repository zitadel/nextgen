# Repository Review Instructions

Zitadel nextgen is pre-release. Review for correctness and contract stability
more than polish.

**Tool-specific rules here are a bootstrap only. Authoritative instructions
live in [`AGENTS.md`](../AGENTS.md) and the nearest scoped `AGENTS.md` for the
touched path** — read those first; the scoped files under
`.github/instructions/` add per-area review pointers, not parallel rules.

- Validation by touched area: `moon ci :lint :typecheck :build :test` for the
  workspace, `go vet ./...` and `go test ./...` for Go, and
  `moon run <project>:<task>` for focused checks (front doors:
  [`AGENTS.md` — Workflow Front Doors](../AGENTS.md#workflow-front-doors)).
- Generated files: never ask authors to hand-edit `api/generated/**`,
  package `dist/**`, or `apps/console/src/routeTree.gen.ts`
  ([`AGENTS.md` — Generated Files](../AGENTS.md#generated-files)).
- CLI contract (JSON envelope, `--silent` capture tip, SKILLS.md sync):
  [`AGENTS.md` — CLI Contract](../AGENTS.md#cli-contract) is canonical.
- The claim lifecycle is shipped
  ([ADR 046](../docs/adrs/046-claim-lifecycle-v2.md)): server claim endpoints
  plus `zitadel claim`. Review claim changes against ADR 046 — the old rule
  to keep the lifecycle out (from Withdrawn ADR 003's era) is obsolete.
- Secrets: project/preview tokens and `.zitadel/secret`-style values must not
  enter source control or browser-safe env metadata.
- Changesets and PR titles: the decision table in
  [`.changeset/README.md`](../.changeset/README.md#decision-table) and
  [`CONTRIBUTING.md#title-format`](../CONTRIBUTING.md#title-format) are
  canonical. Challenge the title type in both directions — it decides what
  reaches customer release notes. Guards:
  `node scripts/check-pr-title.mjs --title "<title>"` and
  `node scripts/check-changesets-status.mjs`.
- Licensing split: [`LICENSING.md`](../LICENSING.md).
- Journey-gate changes (`apps/cli-journey-e2e/**`, `ci.yml` journey steps):
  [`apps/cli-journey-e2e/AGENTS.md`](../apps/cli-journey-e2e/AGENTS.md) is
  canonical (the project id is `cli-journey-e2e`).
- Local runtime command changes: verify `.zitadel/local/` state handling,
  `--server local` resolution, and the zero-config smoke paths per
  [`apps/cli/SKILLS.md`](../apps/cli/SKILLS.md).
