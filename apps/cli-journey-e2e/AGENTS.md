# CLI Journey E2E Instructions

These instructions apply to `apps/cli-journey-e2e/**`. Defer to the root
`AGENTS.md` for repository-wide rules.

## Purpose

This project protects the customer local setup journey across every supported
CLI framework. Tests must exercise a fresh app directory that runs the CLI local
runtime path (`doctor`, `start`, `setup --server local`) before starting the
generated app. It must not test the checked-in demo apps.

## Maintenance Rules

- Keep generated apps and temporary registries outside the repo worktree.
- Use `npm` inside the generated app to match the documented user path.
- Use `moon run release:pack` when producing workspace tarballs; it stages the
  server platform binaries, packs all public packages, and verifies resolved
  package metadata.
- CI may pass prebuilt release snapshot tarballs to the journey runner with
  `--tarballs-dir`; that path must skip rebuilding and still verify/publish the
  provided tarballs through Verdaccio.
- CI must install Zitadel packages from current workflow tarballs through the
  temporary Verdaccio registry, not from public npm.
- CI must run `npx @zitadel/cli@alpha doctor --runtime binary`,
  `start --runtime binary`, and
  `setup --framework <next|nuxt|react|vue|angular|solid|svelte|qwik> --server local`
  from the fresh app directory with `--non-interactive --json`.
- Docker fallback coverage must opt in with `--runtime docker --image <tag>`.
- Pack and upload only the public packages:
  `@zitadel/cli`, `@zitadel/server`, the `@zitadel/server-*` platform
  packages, `@zitadel/api`, `@zitadel/config`, `@zitadel/components`, `@zitadel/sdk-core`,
  `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-react`,
  `@zitadel/sdk-vue`, `@zitadel/sdk-angular`, `@zitadel/sdk-solid`,
  `@zitadel/sdk-svelte`, and `@zitadel/sdk-qwik`. Private support packages must
  stay out of the artifact set.
- Keep the generated app on `localhost` for browser tests. WebAuthn rejects IP
  address relying-party IDs such as `127.0.0.1`.
- Keep each framework suite Playwright-serial and one-worker. Framework suites
  may run in parallel only when each suite gets its own generated app directory,
  npm cache/tmp directories, app port, Zitadel port, and backend runtime state.
- Passkey coverage is required in CI. `JOURNEY_ENABLE_PASSKEY=0` is only a local
  debugging escape hatch.
- Keep diagnostics focused. Upload logs, setup JSON, lockfiles, Playwright
  traces/reports, and metadata; do not upload generated `node_modules` or
  `.next` directories.
