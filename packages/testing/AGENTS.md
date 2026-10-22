# Agent Instructions — `packages/testing`

`@zitadel/testing` is the customer-facing test kit: it boots or connects to a
real instance and drives it, and the login, from Playwright. Its API:
[`README.md`](README.md). The repo dogfoods it in `e2e/demo-next`'s real lane,
`e2e/console`, `console:dev-real` and `e2e/journey`, whose testkit variant
installs the kit from the local registry as a customer would.

## Which layer a test belongs in

Test at the lowest layer that proves the property, and never duplicate it
upward.

1. **Unit** (Vitest, jsdom): markup, props, ARIA, slot projection, event
   shapes, pure logic.
2. **Browser** (Vitest in Chromium, `*.browser.spec.ts`): form association,
   focus delegation, Enter-to-submit, anything needing a real
   `ElementInternals` or `HTMLFormElement`.
3. **End to end** (Playwright, the root `e2e/` project): only what is
   exclusively framework integration (middleware, the `/__nextgen` proxy, a
   real `Set-Cookie` round trip, full-page navigation). Component, atom and
   orchestrator behaviour stays in Vitest. The consumer journey
   (`e2e/journey/`) runs a freshly generated app; the docs site's URL-based
   suite lives beside its app, in `apps/docs/tests/`.

## It is published

- It is on the release train: in `PUBLIC_RELEASE_PACKAGES`
  ([`scripts/release-manifest.mjs`](../../scripts/release-manifest.mjs)) and
  the changesets `fixed` group, in the same order
  (`apps/cli/tests/unit/scripts/release-manifest.test.ts`).
- Every observable change needs a changeset. The kit is shipped product: a
  new capability is `feat` and a repair `fix`, never `test:`
  ([`.changeset/README.md`](../../.changeset/README.md)).
- Never edit versions or dist-tags or publish by hand: the train owns them.
- Keep `LICENSE`, `publishConfig.access` and the `license` field, and the
  package in [`LICENSING.md`](../../LICENSING.md)'s MIT exceptions.
- `build-release` is part of `tools/release/moon.yml`'s
  `build-public-packages`, which `release:check-graph` enforces.

## Build shape

- Playwright's `require()` hook needs a CJS chain end to end, so
  `tsdown.config.ts` builds ESM with the workspace deps external and CJS with
  `@zitadel/api` and `@zitadel/config` bundled (`deps.alwaysBundle`; the
  deprecated `noExternal` silently loses to auto-external). `@zitadel/cli`
  stays external in both. Decide a new workspace runtime dep's side
  explicitly.
- `@playwright/test` is an optional peer: only the `./playwright` entry may
  import it, so the root entry works without Playwright.

## Behaviour pinned by unit tests

Change these tests only when the external fact changes.

- `src/passkey.ts`: the virtual-authenticator options are the profile the
  journey proved. The authenticator is page-bound: register and sign in on
  the same page, and sign out with `context().clearCookies()`, never a fresh
  context. Serve the app on HTTPS or `http://localhost`; an IP origin is not
  a valid RP ID.
- `src/flows.ts`: the locator ladders are the widget's automation-hook
  contract (`packages/components/README.md`). Branch only on what the widget
  renders, never on app state; scope broad fallbacks to the `<zitadel-login>`
  host; escape free-form action names before building a selector.
- `src/session.ts`: the flow is stateless through the sealed `_zflow` cookie
  (raw `fetch` with a one-cookie jar), submits send an `Origin` on the
  project's allowlist, and `/sessions/me` authenticates by cookie, not bearer.
- A helper that needs a step shape `packages/config/defaults/default-login.json`
  does not declare changes the definition first.

## Credentials

Test credentials come from the kit's boot contract, never from the server
([ADR 053 §9](../../docs/adrs/053-cross-project-principals.md),
[console ADR 0004 §2](../../apps/console/docs/adrs/0004-console-deployment-modes.md)).

- Never add or lean on a server `--test-mode` flag, a seed-default
  credential or a direct database write. A credential the kit cannot capture
  at provisioning extends the provisioning contract instead.
- New credentials extend `InstanceHandle` (the `platform` slot is the
  contract point). Keep it serializable: it crosses processes in the
  handshake file.
- Add a credential field only once its design is settled, as an optional
  field, never with an invented wire prefix. Serialize only state that cannot
  be derived (a session is `{ sessionToken, expiresAt }`, not a cookie).
- Dev loops feed from boot output: `console:dev-real` uses
  `handle.projectSecret` server-side only. Never reintroduce remembered
  credential env vars.
- Keep every seed op meaningful against a `connectZitadel` target, not only a
  local instance, and let helpers do only what a customer's test could (no
  `page.evaluate` shortcuts).

## Moon and the e2e lanes

- The moon layer is `tool`, between the e2e suites (`automation`) and the CLI
  (`tool`). Consumers add `dependsOn: testing` and a `testing:build` task dep.
- Unit gate: `moon run testing:test testing:lint testing:typecheck`; real
  instances: `moon run testing:test-integration`.
- `e2e:all` (`e2e/moon.yml`) depends on every lane CI runs,
  `testing:test-integration` among them, and `ci.yml` runs it in its own e2e
  step after the build-and-test graph. The lanes are `runInCI: "skip"` only to
  stay out of that graph, so a plain `:test` stays unit tests.
- Run one lane with `moon run e2e:<lane>`, or all with `moon run e2e:all`;
  the journey lane then needs prebuilt tarballs in `JOURNEY_TARBALLS_DIR`
  (`e2e/moon.yml` says why).
- Serialize moon invocations: two concurrent graphs produce spurious
  failures. `moon run workspace:cli -- stop --all` sweeps the runtimes an
  aborted run left on fixed ports.
