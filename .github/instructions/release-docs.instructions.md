---
applyTo: "README.md,docs/**/*.md,.changeset/**,.github/workflows/**,.goreleaser.yaml,LICENSING.md"
---

# Release, Docs, And CI Review Instructions

Review documentation and release changes for consistency with the pre-release
state of the repo.

- CI should continue to cover Go vet/tests, pnpm install/typecheck/test/build,
  CLI smoke checks, npm pack dry runs, and non-publishing GoReleaser snapshots.
- The release workflow is manual and draft-oriented while the repo is
  pre-release. Do not imply official npm publishing is enabled.
- npm package changes use changesets; Go server releases use GoReleaser.
- Keep licensing text aligned with `LICENSING.md`: AGPL-3.0-only by default,
  MIT exceptions for CLI, SDKs, API contracts, and docs.
- Docs that mention agent behavior should point to `AGENTS.md` or the generated
  CLI contract rather than duplicating long command tables.
