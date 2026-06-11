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
- The product release workflow is manual and draft-oriented while the repo is
  pre-release. npm package publishing uses Changesets trusted publishing; keep
  the full release sequence in `docs/operations/releasing.md` in sync with any
  release workflow, Changesets, GoReleaser, or helper-script change.
- npm package changes use changesets; Go server releases use GoReleaser.
- Public preview docs should use `@zitadel/cli@preview` and
  `ghcr.io/zitadel/zitadel-preview`; keep `nextgen` only for repo-internal or
  temporary compatibility alias contexts.
- Keep licensing text aligned with `LICENSING.md`: AGPL-3.0-only by default,
  MIT exceptions for CLI, SDKs, API contracts, and docs.
- Docs that mention repo behavior should point to `AGENTS.md`; docs that mention
  the CLI agent contract should point to `apps/cli/SKILLS.md`.
