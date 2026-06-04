# Repository Review Instructions

Zitadel nextgen is pre-release. Review for correctness and contract stability
more than polish.

- Run or request validation by touched area: pnpm typecheck/test/build for
  TypeScript packages, `go vet ./...` and `go test ./...` for Go, package smoke
  checks for publishable npm changes.
- Treat generated files carefully. Do not ask authors to hand-edit
  `api/generated/**`, package `dist/**`, or the generated block in
  `apps/cli/AGENTS.md`.
- Preserve the CLI JSON envelope. In `--json` mode stdout must stay parseable,
  with top-level `cli_version`, `command`, `source`, and `status`; diagnostics
  belong in structured fields or stderr when appropriate.
- Protect the claim boundary. Agents may surface a human `claim_url`, but must
  not complete account ownership or hide production-apply requirements.
- Watch for secret leakage. Project, preview, token, and `.zitadel/secret` style
  values must not enter source control or browser-safe env metadata.
- User-visible changes under `apps/cli/` or `packages/sdk-*` need a changeset.
  npm package manifests must keep `"license": "MIT"`.
- Server and embedded console changes are AGPL-3.0-only by default; public API,
  docs, CLI, and SDK paths are MIT exceptions per `LICENSING.md`.
- For `consumer-journey-e2e` or `apps/cli-journey-e2e/**` changes, verify that
  the test uses current workflow artifacts, a temporary registry for Zitadel
  packages, the CLI JSON setup contract, required passkey coverage in CI, and
  focused diagnostics that exclude bulky generated app directories.
