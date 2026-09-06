# @zitadel/cli-journey-e2e

Fresh-app Playwright coverage for the customer local setup journey.

This project is private test infrastructure. It does not test the checked-in
demo apps. Instead, it builds the current workspace packages, publishes packed
tarballs to a temporary registry, creates empty app directories outside the
repo, runs the customer local CLI flow through `npx`, starts the generated apps,
and verifies that real users can register, log out, and log in again across
all eight frameworks: Next, Nuxt, React, Vue, Angular, Solid, Svelte, and
Qwik (`scripts/frameworks.mjs` is the authoritative list).

## Local runner

```sh
moon run workspace:journey
```

The default mode runs the full framework matrix in parallel. It uses the
`@zitadel/server` npm binary runtime and does not require Docker:

1. Ensure the Playwright Chromium browsers are installed.
2. Build and pack the public workspace packages with `moon run release:pack`.
3. Verify tarballs are installable and do not contain `catalog:` or
   `workspace:` dependency specs.
4. Start Verdaccio as a Node process with npmjs proxying enabled.
5. Publish tarballs to Verdaccio with `alpha` and `latest` tags.
6. Install `@zitadel/cli` and `@zitadel/server` from the temporary registry.
7. Create one empty app directory per selected framework in a temporary directory.
8. Run `npx <cli-package>@alpha doctor --runtime binary --non-interactive --json`.
9. Run `npx <cli-package>@alpha start --runtime binary --non-interactive --json`.
10. Run `npx <cli-package>@alpha setup --framework <id> --server local --non-interactive --json`.
11. Start each generated app on `localhost`.
12. Run the Playwright tests with one worker per framework journey.

### Options

```sh
moon run workspace:journey -- --keep
moon run workspace:journey -- --work-dir /tmp/zitadel-journey
moon run workspace:journey -- --runtime docker --image nextgen:local
moon run workspace:journey -- --framework next
moon run workspace:journey -- --preexisting-app
moon run workspace:journey -- --concurrency 2
moon run workspace:journey -- --tarballs-dir dist/release/<version>/npm
```

- `--framework <id>` runs one framework (`next`, `nuxt`, `react`, `vue`,
  `angular`, `solid`, `svelte`, or `qwik`) instead of the full matrix.
- `--suite frameworks|testkit` selects the lane: `frameworks` (default) runs
  the scaffold journey matrix; `testkit` runs the `@zitadel/testing` consumer
  lane.
- `--preexisting-app` seeds the minimal host app from
  `fixtures/preexisting/<framework>` before running setup, so the scaffolded
  pages take the `variant="widget"` posture inside the host app's own shell
  (ADR 044). Defaults the matrix to `next` and `nuxt` — the posture is scoped
  to the route-based frameworks.
- `--concurrency <n>` controls local framework parallelism. The default is `5`.
- `--runtime binary|docker` selects the local runtime backend. The default is
  `binary`.
- `--image <docker-tag>` uses an existing local runtime image instead of
  building one and implies `--runtime docker`.
- `--tarballs-dir <path>` uses prebuilt release npm tarballs instead of running
  `moon run release:pack`.
- `--keep` keeps the temporary work directory after success.
- `--work-dir <path>` uses an explicit work directory.

Useful environment overrides:

- `JOURNEY_REGISTRY_PORT`
- `JOURNEY_APP_PORT` for single-framework runs only
- `JOURNEY_ZITADEL_PORT` for single-framework runs only
- `JOURNEY_TARBALLS_DIR` to use prebuilt release npm tarballs
- `JOURNEY_ENABLE_PASSKEY=0` as a local-only escape hatch while debugging
  passkey setup. CI must run passkey coverage — the `passkey-first` preset
  lane, which is the only shipped preset whose flow offers a passkey.

## CI gate

The required PR CI job runs the framework matrix against the default binary
runtime. It does not use public Zitadel packages or GHCR images; it publishes
the current workflow's package tarballs to Verdaccio and runs the same `npx`
local setup flow against the generated app. The Docker fallback journey remains
an opt-in local/manual check via
`moon run workspace:journey -- --runtime docker --image <docker-tag>`. Private
support packages such as design tokens are bundled into the public packages
that need them and must not be uploaded or published.

Failure diagnostics intentionally stay small: Playwright report/output,
doctor/start/setup JSON and stderr, local runtime metadata/logs, metadata,
generated app `package.json` and lockfile, Verdaccio logs, and
generated app logs. Do not upload generated app `node_modules` or framework
build directories.

## Coverage

Each framework suite is serial and one-worker because every test in that suite
shares the same fresh backend and generated app instance. Local all-framework
runs execute framework suites in parallel.

- CLI local setup contract: doctor, start, and setup exit successfully, stdout
  parses as JSON, `status` is `ok`, the generated app depends on the local SDK
  package, and Zitadel packages resolve from the temporary registry.
- Password-only account: register with email/password, skip passkey setup, log
  out, and log in again with password.
- Passkey account (`--preset passkey-first` only): register through the entry
  step's email fallback with a passkey, log out, and log in again with one tap.
  The default `password-first` flow offers no passkey action, so this journey
  does not apply to it.
- Pre-existing-app lane (`--preexisting-app`, Next and Nuxt): setup against the
  seeded host app emits `variant="widget"` + `theme="auto"` pages, records
  `posture` in the scaffold manifest, keeps the host's own homepage and shell,
  and the same register/logout/login journeys run through the widget-posture
  pages inside the host layout (ADR 044).
