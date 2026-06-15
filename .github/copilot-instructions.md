# Repository Review Instructions

Zitadel nextgen is pre-release. Review for correctness and contract stability
more than polish.

- Run or request validation by touched area: pnpm typecheck/test/build for
  TypeScript packages, `go vet ./...` and `go test ./...` for Go, package smoke
  checks for publishable npm changes.
- Treat generated files carefully. Do not ask authors to hand-edit
  `api/generated/**` or package `dist/**`.
- Treat `apps/cli/SKILLS.md` as the current CLI agent guidance and keep it in
  sync with CLI behavior.
- Keep the two local-development front doors separate: contributors use root
  `corepack pnpm run ...` scripts, while customers use published
  `zitadel ...` runtime commands and `--server local`.
- Preserve the CLI JSON envelope. In `--json` mode stdout must stay parseable,
  with top-level `cli_version`, `command`, `source`, and `status`; diagnostics
  belong in structured fields or stderr when appropriate.
- For local JSON capture, prefer
  `corepack pnpm --silent run cli -- ... --json`; plain `pnpm run` prints its
  own script prelude before CLI stdout.
- Do not reintroduce the removed pre-claim / claim lifecycle unless a real
  server contract lands first.
- Watch for secret leakage. Project, preview, token, and `.zitadel/secret` style
  values must not enter source control or browser-safe env metadata.
- User-visible changes to a public npm package need a changeset; follow the
  **Changesets** decision table in `AGENTS.md` (paths, when to skip, when to
  add a real vs empty file). Author `.changeset/<slug>.md` directly rather than
  via the interactive prompt. npm package manifests must keep `"license": "MIT"`.
- PR metadata must follow `AGENTS.md`: verify the title against
  `.github/semantic.yml`, prefer a scope-free title when unsure, and keep the
  PR description current with summary, validation, changeset, and notes.
- Server and embedded console changes are AGPL-3.0-only by default; public API,
  docs, CLI, and SDK paths are MIT exceptions per `LICENSING.md`.
- For `consumer-journey-e2e` or `apps/cli-journey-e2e/**` changes, verify that
  the test uses current workflow artifacts, a temporary registry for Zitadel
  packages, the CLI JSON setup contract, required passkey coverage in CI, and
  focused diagnostics that exclude bulky generated app directories.
- For local runtime command changes, verify Docker command construction, local
  `.zitadel/local/` state handling, `--server local` resolution, and the
  zero-config image smoke path with no `NEXTGEN_SERVER_ENCRYPTION_KEY`.
