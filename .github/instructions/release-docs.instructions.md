---
applyTo: "README.md,docs/**/*.md,.changeset/**,.github/workflows/**,LICENSING.md"
---

# Release, Docs, And CI Review Instructions

Review documentation and release changes for consistency with the pre-release
state of the repo.

- The CI gate is the `full-pr` job in `.github/workflows/ci.yml`: a Moon graph
  run plus per-database Go integration lanes, four gated journey variants
  (contract: [`apps/cli-journey-e2e/AGENTS.md`](../../apps/cli-journey-e2e/AGENTS.md),
  the project id is `cli-journey-e2e`), real-instance suite lanes, the
  binary-served console embedded-surface lane, and the version-PR path. Mirror
  locally with `moon run workspace:check -- --full`
  ([CONTRIBUTING.md](../../CONTRIBUTING.md#what-ci-runs)).
- The release workflow publishes alpha npm packages and containers, then
  creates or updates a draft product GitHub Release shell; product prose stays
  manual until maintainers publish the draft
  ([`docs/runbooks/manual-release.md`](../../docs/runbooks/manual-release.md)).
- npm package changes use changesets; Go server artifacts and containers use
  Moon release tasks. Decision table:
  [`.changeset/README.md`](../../.changeset/README.md#decision-table).
- Keep licensing text aligned with [`LICENSING.md`](../../LICENSING.md).
- Docs that mention repo behavior point at `AGENTS.md`; changeset requirements
  at `.changeset/README.md`; PR title conventions at
  [`CONTRIBUTING.md#title-format`](../../CONTRIBUTING.md#title-format); the
  CLI agent contract at `apps/cli/SKILLS.md`. Define a rule once and link it —
  do not restate it into a second home.
- Changeset summaries are customer-facing copy rendered verbatim into
  `CHANGELOG.md` and the GitHub Release. Review them for a reader who uses our
  SDKs and products and has no repo context — no ADR numbers, PR numbers, or
  internal file paths.
