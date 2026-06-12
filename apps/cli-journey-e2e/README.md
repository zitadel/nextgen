# @zitadel/cli-journey-e2e

Fresh-app Playwright coverage for the customer local setup journey.

This project is private test infrastructure. It does not test the checked-in
demo apps. Instead, it builds the current workspace packages, publishes packed
tarballs to a temporary registry, creates an empty app directory outside the
repo, runs the customer local CLI flow through `npx`, starts the generated app,
and verifies that a real user can register, log out, and log in again.

## Local runner

```sh
corepack pnpm run journey
```

The default mode uses Docker for Verdaccio and for the CLI-managed local
runtime. It builds a local runtime image unless `--image` is provided:

1. Ensure the Playwright Chromium browsers are installed.
2. Build the public workspace packages.
3. Pack package tarballs with `corepack pnpm --dir <package> pack`.
4. Verify tarballs are installable and do not contain `catalog:` or
   `workspace:` dependency specs.
5. Start Verdaccio with npmjs proxying enabled.
6. Publish tarballs to Verdaccio with `alpha` and `latest` tags.
7. Build or use a local runtime Docker image for `zitadel start`.
8. Create an empty app directory in a temporary directory.
9. Run `npx <cli-package>@alpha doctor --non-interactive --json`.
10. Run `npx <cli-package>@alpha start --non-interactive --json`.
11. Run `npx <cli-package>@alpha setup --framework next --server local --non-interactive --json`.
12. Start the generated app on `localhost`.
13. Run the Playwright tests with one worker.

### Options

```sh
corepack pnpm run journey -- --keep
corepack pnpm run journey -- --work-dir /tmp/zitadel-journey
corepack pnpm run journey -- --image nextgen:local
```

- `--image <docker-tag>` uses an existing local runtime image instead of
  building one.
- `--keep` keeps the temporary work directory after success.
- `--work-dir <path>` uses an explicit work directory.

Useful environment overrides:

- `JOURNEY_REGISTRY_PORT`
- `JOURNEY_APP_PORT`
- `JOURNEY_ENABLE_PASSKEY=0` as a local-only escape hatch while debugging
  passkey setup. CI must run passkey coverage.

## CI gate

The `consumer-journey-e2e` workflow job does not use public Zitadel packages or
GHCR images. It downloads the GoReleaser snapshot image and the public npm
package tarballs produced by the same workflow, publishes those tarballs to
Verdaccio, points `ZITADEL_LOCAL_IMAGE` at the loaded image, runs the same
`npx` local setup flow, and runs the same Playwright project against the
generated app. Private support packages such as design tokens are bundled into
the public packages that need them and must not be uploaded or published.

Failure diagnostics intentionally stay small: Playwright report/output,
doctor/start/setup JSON and stderr, local runtime metadata/logs, metadata,
generated app `package.json` and `package-lock.json`, Verdaccio logs, and Next
logs. Do not upload generated app `node_modules` or `.next` directories.

## Coverage

The suite is serial and one-worker because every test shares the same fresh
backend and generated app instance.

- CLI local setup contract: doctor, start, and setup exit successfully, stdout
  parses as JSON, `status` is `ok`, the generated app depends on the local SDK
  package, and Zitadel packages resolve from the temporary registry.
- Password-only account: register with email/password, skip passkey setup, log
  out, and log in again with password.
- Passkey-only account: register with email/passkey, log out, and log in again
  with passkey.
- Password-plus-passkey account: register with password, accept passkey setup,
  log out, log in with password, log out, and log in with passkey.
