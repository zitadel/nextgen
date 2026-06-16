---
applyTo: "README.md,docs/**/*.md,.changeset/**,.github/workflows/**,.goreleaser.yaml,LICENSING.md"
---

# Release, Docs, And CI Review Instructions

Review documentation and release changes for consistency with the pre-release
state of the repo.

- CI should continue to cover Go vet/tests, pnpm install/typecheck/test/build,
  CLI smoke checks, npm pack dry runs, non-publishing GoReleaser snapshots, and
  the `consumer-journey-e2e` fresh-app quality gate.
- Local-runtime image changes should preserve the zero-config Docker smoke:
  mounted `nextgen-data`, generated `server-encryption-key`, embedded Postgres,
  and no required `NEXTGEN_SERVER_ENCRYPTION_KEY`.
- The release workflow is manual and draft-oriented while the repo is
  pre-release. Do not imply official npm publishing is enabled.
- npm package changes use changesets; Go server releases use GoReleaser.
  Changeset PR workflow (decision table, publishable paths, CI gate) lives in
  [`.changeset/README.md`](../.changeset/README.md).
- Keep licensing text aligned with `LICENSING.md`: AGPL-3.0-only by default,
  MIT exceptions for CLI, SDKs, API contracts, and docs.
- Docs that mention repo behavior should point to `AGENTS.md`; docs that mention
  changeset requirements should point to `.changeset/README.md`; docs that
  mention the CLI agent contract should point to `apps/cli/SKILLS.md`.
