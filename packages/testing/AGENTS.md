# testing Agent Notes

Scoped instructions for `packages/testing/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

`@zitadel/testing` is the customer-facing test kit — "Testcontainers for
Zitadel": it boots a real local instance (`startLocalZitadel` /
`connectZitadel`), orchestrates instance + app for Playwright
(`withZitadel`), seeds users and sessions (`seed.*`, `authenticatedPage`),
completes passkey ceremonies headlessly (`enableVirtualPasskey`), and
drives the `<zitadel-login>` widget through whole auth ceremonies
(`loginWithPassword`, `registerWithPasskey`, …, with `flowAction` /
`flowField` as escape hatches).

In-repo consumers, which double as the dogfood proof:

- `apps/demo-next-e2e` (`e2e-real`) — flagship Playwright consumer.
- `apps/console-e2e` (`e2e-real`) and `console:dev-real` — kit as suite
  bootstrapper and as dev-loop seeder.
- `apps/cli-journey-e2e` — the product journey imports kit helpers as a
  workspace dep; the `e2e-testkit` lane installs the kit **from the local
  registry** exactly as a customer would. Breaking the customer install
  path shows up there, not in unit tests.

## It is published — act like it

On the release train since #692: listed in `PUBLIC_RELEASE_PACKAGES`
([`scripts/release-manifest.mjs`](../../scripts/release-manifest.mjs)) and in
the changesets `fixed` group — the two lists must match **in order**
(enforced by `apps/cli/tests/unit/scripts/release-manifest.test.ts`).
Consequences:

- **Every observable change needs a changeset** (minor for new API surface),
  and PR titles follow the outcome-based decision table in
  [`.changeset/README.md`](../../.changeset/README.md). The kit-specific
  trap: don't reach for `test:` because the package is *about* testing —
  it is shipped product surface, so a new capability is `feat` and a
  repair is `fix`.
- **The `alpha` dist-tag is intentional.** The train publishes in changesets
  pre mode, so releases land on `npm i @zitadel/testing@alpha`; `latest`
  deliberately sits at the `0.0.0` bootstrap placeholder until pre mode
  ends. Do not "fix" the tag, and do not flag it in review.
- `build-release` (in `moon.yml`) precleans via `release-clean.mjs` and
  rebuilds; it is registered in `tools/release/moon.yml`'s
  `build-public-packages` aggregate and `release:check-graph` enforces
  that registration. It needs no mutex: nothing in the release graph reads
  this package's dist, task deps alone order it.

## Build shape: dual ESM+CJS, and why the CJS bundles workspace deps

Playwright's Babel `require()` hook transpiles workspace-realpath ESM to
CJS while Node still evaluates the real `.mjs` as ESM — the require chain
must stay CJS end-to-end. So `tsdown.config.ts` builds twice: ESM with all
workspace deps external, CJS with `@zitadel/api` + `@zitadel/config`
**bundled in** (`deps.alwaysBundle`; the deprecated `noExternal` silently
loses to auto-external). `@zitadel/cli` stays external in both — it is a
regular published dependency resolved at install time. If you add a
workspace runtime dep, decide its side of that line explicitly.

`@playwright/test` is an **optional peer** (`>=1.60`): only the
`./playwright` entry may import it. Never let it leak into `./` — the
vitest/backend surface must work without Playwright installed.

## Behavior contracts locked by unit tests

These encode externally-proven behavior; the unit suites pin them so a
refactor cannot drift silently. Change the test only when the external
fact changes:

- **Passkey CDP profile** (`src/passkey.ts`): the exact
  `WebAuthn.addVirtualAuthenticator` options are the journey-CI-proven
  profile (ctap2, internal, resident keys, user verification, automatic
  presence). Changing any flag changes which ceremonies complete. The
  authenticator is **page-bound** — registration and the later login must
  run on the same page; sign out via `context().clearCookies()`, never a
  fresh context. RP-ID rule: serve the app on HTTPS or `http://localhost`;
  raw IP origins are invalid.
- **Flow ceremonies** (`src/flows.ts`): the locator ladders are the
  widget's documented automation-hook contract
  (`packages/components/README.md`), locked by descriptor-equality unit
  tests. Ceremonies branch only on **widget-observable state** (which
  fields/actions render), never on app state — customer flow configs
  legitimately vary. Broad fallbacks (accessible names, labels, bare
  `data-action`) stay scoped to the `<zitadel-login>` host: `.or()` unions
  resolve in page-wide DOM order, so an unscoped candidate could match app
  chrome; the host also exists for custom templates that emit no hooks.
  Free-form action names are escaped per the CSSOM string-serialization
  rules before attribute-selector interpolation (#715), so an exotic name
  cannot break the union's parsing.
- **Session-mint driver** (`src/session.ts`): the flow is stateless via
  the sealed `_zflow` cookie (raw `fetch` + one-cookie jar — the typed
  client hides response headers), submits must send an `Origin` on the
  project allowlist, and `/sessions/me` authenticates via the session
  cookie, not bearer.
- The flow-step shape itself is owned by
  [`packages/config/defaults/default-login.json`](../config/defaults/default-login.json).
  If a kit helper needs a shape the definition does not declare, the
  definition changes first (same rule as `packages/api-mock`).

## Credential contract (root ADR 052 §9)

Predictable test/dev credentials are a property of **this kit**, never of the
server or the production seed contract. The kit boots the process and applies
seeds, so it captures credentials from provisioning output (`POST /projects`
returns `project_secret` exactly once) and exposes them on `InstanceHandle`:
`projectSecret` today; the `platform` slot (`PlatformCredentials` — reserved
project id, publishable key, scoped `sk_plat_` key, operator session) once the
platform-project provisioner lands. Root ADR 052 §9 (Proposed, lands with
PR #876): "test infrastructure obtains credentials through the testkit's boot
contract, never through a seed default"; Console ADR 0004 §2 names the
testkit as the bootstrap transport test and dev infrastructure use. Until
#876 is accepted, treat the slot as tracking that proposal — it is inert, so
a wording shift there moves this shape, not shipped behavior.

Consequences for changes here:

- Never add — or lean on — a server `--test-mode` flag, a seed-default
  credential, or any other server-side door that mints deterministic
  credentials. If the kit cannot capture a credential at provisioning time,
  fix the kit's boot path (which may also write through its existing storage
  access), not the server surface.
- New credentials extend `InstanceHandle` — the `platform` slot is the
  contract point; don't invent a parallel channel. The handle must stay
  serializable: it crosses process boundaries via the handshake file, and
  `AppEnvTemplate` deliberately reaches only its flat string fields.
- Dev loops feed from boot output: `console:dev-real` threads
  `handle.projectSecret` into the Vite proxy env itself (and prints it under
  `--seed-only`). Don't reintroduce developer-remembered credential env vars.

## Moon layering

The layer is `tool`, not `library` — deliberately between the e2e suites
(`automation`, which may not depend on `automation`) and the CLI (`tool`,
which `library` may not depend on). Consumers add `dependsOn: testing` and
a `testing:build` task dep.

## Validation lanes

- `moon run testing:test testing:lint testing:typecheck` — unit gate.
- `moon run testing:test-integration` — boots real instances
  (binary + SQLite local default).
- Dogfood: `moon run demo-next-e2e:e2e-real`, `moon run console-e2e:e2e-real`,
  `env -u CI moon run cli-journey-e2e:e2e-testkit` (customer install path).

The real-instance lanes carry `runInCI: false`, but that only keeps them
out of moon's automatic CI selection — `full-pr` runs all of them through
explicit `env -u CI` workflow steps (`.github/workflows/ci.yml`). Locally,
use the same `env -u CI` incantation.

Serialize moon invocations — two concurrent graphs produce spurious
failures. Orphaned runtimes from aborted e2e runs squat fixed ports;
`moon run workspace:cli -- stop --all` sweeps them.

## Don't

- Don't make seed ops instance-specific. Every seed op must stay
  meaningful for `connectZitadel` targets (remote dev instances), not just
  locally-booted ones — the README positions the local runtime as the
  shipped core and remote mode as roadmap, and seed ops must not foreclose
  that direction.
- Don't publish-adjacent by hand: no version edits, no dist-tag changes,
  no manual `npm publish`. The train owns all of it (the one-time name
  bootstrap already happened).
- Don't remove the `LICENSE` file or `publishConfig.access` — published
  sibling parity, checked in review not by tooling. The package is listed
  in the root [`LICENSING.md`](../../LICENSING.md) MIT exceptions; keep
  the `license` field, the `LICENSE` file, and that list in agreement.
- Don't reach for `page.evaluate`-style shortcuts in helpers that model
  customer usage; helpers must only do what a customer's test could do
  with the public product surface.
