---
applyTo: "README.md,docs/**/*.md,.changeset/**,.github/workflows/**,LICENSING.md"
---

# Release, Docs, And CI Review Instructions

Review documentation and release changes for consistency with the pre-release
state of the repo.

- Docs that describe CI must match `.github/workflows/ci.yml`; prefer a link to
  [CONTRIBUTING.md](../../CONTRIBUTING.md#what-ci-runs) over a restated step
  list.
- The release flow is in
  [`docs/runbooks/manual-release.md`](../../docs/runbooks/manual-release.md);
  whether a change needs a changeset is in the
  [decision table](../../.changeset/README.md#decision-table).
- Keep licensing text aligned with [`LICENSING.md`](../../LICENSING.md).
- Define a rule once and link it: repo behavior in `AGENTS.md`, changeset
  requirements in `.changeset/README.md`, PR title conventions in
  [`CONTRIBUTING.md#title-format`](../../CONTRIBUTING.md#title-format), the CLI
  agent contract in `apps/cli/skills/zitadel-cli/SKILL.md`. Flag a second home.
- Changeset summaries are customer-facing copy rendered verbatim into
  `CHANGELOG.md` and the GitHub Release. Review them for a reader who uses our
  SDKs and products and has no repo context — no ADR numbers, PR numbers, or
  internal file paths.
