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
- Use `corepack pnpm --dir <package> pack` when producing workspace tarballs;
  this keeps installable package metadata and resolves pnpm workspace/catalog
  protocols.
- CI must install Zitadel packages from current workflow tarballs through the
  temporary Verdaccio registry, not from public npm.
- CI must run `npx @zitadel/cli@alpha doctor`, `start`, and
  `setup --framework <next|nuxt|react|vue|angular> --server local` from the
  fresh app directory with `--non-interactive --json`.
- Pack and upload only the public packages:
  `@zitadel/cli`, `@zitadel/api`, `@zitadel/components`,
  `@zitadel/sdk-core`, `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`,
  `@zitadel/sdk-react`, `@zitadel/sdk-vue`, and `@zitadel/sdk-angular`.
  Private support packages must stay out of the artifact set.
- Keep the generated app on `localhost` for browser tests. WebAuthn rejects IP
  address relying-party IDs such as `127.0.0.1`.
- Keep Playwright serial and one-worker unless each scenario gets isolated
  backend state.
- Passkey coverage is required in CI. `JOURNEY_ENABLE_PASSKEY=0` is only a local
  debugging escape hatch.
- Keep diagnostics focused. Upload logs, setup JSON, lockfiles, Playwright
  traces/reports, and metadata; do not upload generated `node_modules` or
  `.next` directories.
