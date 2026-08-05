---
applyTo: "README.md,docs/**/*.md,.changeset/**,.github/workflows/**,LICENSING.md"
---

# Release, Docs, And CI Review Instructions

Review documentation and release changes for consistency with the pre-release
state of the repo.

- CI should continue to cover Go vet/tests, pnpm install/typecheck/test/build,
  CLI smoke checks, npm pack dry runs, Moon release snapshots, and the
  `consumer-journey-e2e` fresh-app quality gate.
- Local-runtime image changes should preserve the zero-config Docker smoke:
  mounted `nextgen-data`, a generated master key under `master-keys/`, embedded
  Postgres, and no required master-key configuration.
- The release workflow publishes alpha npm packages and containers, then creates
  or updates a draft product GitHub Release shell. Product prose remains manual
  until maintainers publish the draft.
- npm package changes use changesets; Go server artifacts and containers use
  Moon release tasks.
  Changeset PR workflow (decision table, publishable paths, CI gate) lives in
  [`.changeset/README.md`](../../.changeset/README.md).
- Keep licensing text aligned with `LICENSING.md`: AGPL-3.0-only by default,
  MIT exceptions for CLI, SDKs, API contracts, and docs.
- Docs that mention repo behavior should point to `AGENTS.md`; docs that mention
  changeset requirements should point to `.changeset/README.md`; docs that
  mention PR title conventions should point to
  [`CONTRIBUTING.md#title-format`](../../CONTRIBUTING.md#title-format); docs that
  mention the CLI agent contract should point to `apps/cli/SKILLS.md`.
- Changeset summaries are customer-facing copy: they are rendered verbatim into
  `CHANGELOG.md` and the GitHub Release. Review them for a reader who uses our
  SDKs and products and has no repo context — no ADR numbers, PR numbers, or
  internal file paths.
