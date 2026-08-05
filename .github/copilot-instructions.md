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
- Changes that ship in the product release need a changeset — including Go server
  changes from implementation paths like `internal/` (list `@zitadel/server`).
  Follow the
  [decision table in `.changeset/README.md`](../.changeset/README.md#decision-table);
  author `.changeset/<slug>.md` directly, not via the interactive prompt.
- PR metadata must follow `AGENTS.md`: verify the title against
  `.github/semantic.yml`, prefer a scope-free title when unsure, and keep the
  PR description current with summary, validation, changeset, and notes.
- Challenge the title type in both directions, since it decides what reaches
  customer release notes. A PR that ships nothing to a user of the SDKs, CLI,
  API, console, or login UI must not be `feat` or `fix`. A PR that changes a
  shipped default, a generated file a customer receives, or any user-visible
  behavior must not hide under `docs`, `chore`, or `build`. Rule and worked
  examples: [CONTRIBUTING.md](../CONTRIBUTING.md#title-format).
- Server and embedded console changes are AGPL-3.0-only by default; public API,
  docs, CLI, and SDK paths are MIT exceptions per `LICENSING.md`.
- For `consumer-journey-e2e` or `apps/cli-journey-e2e/**` changes, verify that
  the test uses current workflow artifacts, a temporary registry for Zitadel
  packages, the CLI JSON setup contract, required passkey coverage in CI, and
  focused diagnostics that exclude bulky generated app directories.
- For local runtime command changes, verify Docker command construction, local
  `.zitadel/local/` state handling, `--server local` resolution, and the
  zero-config image smoke path with no encryption-key configuration.
