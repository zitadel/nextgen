# @zitadel/cli-journey-e2e

Fresh-app Playwright coverage for the CLI onboarding journey.

This project is private test infrastructure. It does not test the checked-in
demo apps. Instead, it builds the current workspace packages, publishes packed
tarballs to a temporary registry, creates a new Next.js app outside the repo,
runs `zitadel setup`, starts the generated app, and verifies that a real user
can register, log out, and log in again.

## Local runner

```sh
corepack pnpm run journey
```

The default mode uses Docker only for Verdaccio. The backend runs from local
source with embedded Postgres:

1. Build the six public workspace packages.
2. Pack package tarballs with `corepack pnpm --dir <package> pack`.
3. Verify tarballs are installable and do not contain `catalog:` or
   `workspace:` dependency specs.
4. Start Verdaccio with npmjs proxying enabled.
5. Publish tarballs to Verdaccio with `alpha` and `latest` tags.
6. Start `go run .` on a free local port.
7. Create a pinned `create-next-app` project in a temporary directory.
8. Run CLI setup through `npx <cli-package>@alpha`.
9. Run `npm install` in the generated app against the temporary registry.
10. Start the generated app on `localhost`.
11. Run the Playwright tests with one worker.

### Options

```sh
corepack pnpm run journey -- --keep
corepack pnpm run journey -- --work-dir /tmp/zitadel-journey
corepack pnpm run journey -- --backend image --image nextgen:local
```

- `--backend source` runs `go run .` with embedded Postgres. This is the
  default.
- `--backend image --image <docker-tag>` runs the backend through
  `docker-compose.local.yaml` for image parity.
- `--keep` keeps the temporary work directory after success.
- `--work-dir <path>` uses an explicit work directory.

Useful environment overrides:

- `JOURNEY_REGISTRY_PORT`
- `JOURNEY_BACKEND_PORT`
- `JOURNEY_APP_PORT`
- `JOURNEY_ENABLE_PASSKEY=0` as a local-only escape hatch while debugging
  passkey setup. CI must run passkey coverage.

## CI gate

The `consumer-journey-e2e` workflow job does not use public Zitadel packages. It
downloads the GoReleaser snapshot image and the six public npm package tarballs
produced by the same workflow, publishes those tarballs to Verdaccio, creates a
fresh Next.js app, and runs the same Playwright project against the generated
app. Private support packages such as design tokens are bundled into the public
packages that need them and must not be uploaded or published.

Failure diagnostics intentionally stay small: Playwright report/output, setup
JSON, setup stderr, metadata, generated app `package.json` and
`package-lock.json`, Verdaccio logs, Next logs, and backend compose logs.
Do not upload generated app `node_modules` or `.next` directories.

## Coverage

The suite is serial and one-worker because every test shares the same fresh
backend and generated app instance.

- CLI/setup contract: setup exits successfully, stdout parses as JSON,
  `status` is `ok`, the generated app depends on the local SDK package, and
  Zitadel packages resolve from the temporary registry.
- Password-only account: register with email/password, skip passkey setup, log
  out, and log in again with password.
- Passkey-only account: register with email/passkey, log out, and log in again
  with passkey.
- Password-plus-passkey account: register with password, accept passkey setup,
  log out, log in with password, log out, and log in with passkey.
