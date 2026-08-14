# @zitadel/testing

Test-kit for **seeded ephemeral local Zitadel instances**: boot the real server
(binary runtime + SQLite by default, no Docker) from test code, create a
project with the default login flow, and mint password users that can complete
the real login journey immediately.

> **Status: alpha.** Published to npm on the shared release train — the kit
> carries the same version as `@zitadel/cli` and the SDKs, the train publishes
> under the `alpha` dist-tag (install with `@alpha`), and APIs can still move
> between alphas. macOS/Linux (see [Known limitations](#known-limitations)).

## Why

The repo previously had two extremes: the demo e2e suites run against
`@zitadel/api-mock` (fast, but fake — no user store, no real crypto), and
`cli-journey-e2e` runs the real packaged product but creates users by clicking
through the registration UI, serialized per suite. This kit fills the middle:
**real server, programmatic seeding, parallel-safe per-test users.**

## Quick start (Playwright)

```sh
npm i -D @zitadel/testing@alpha @playwright/test
```

The kit drives the `zitadel` CLI, which resolves the published
`@zitadel/server` platform binary on its own — no binary paths, no env vars.

One instance per suite, seeded per test. `withZitadel()` generates the
`webServer` entries that boot the instance and run your app against it — no
wrapper scripts:

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import { nextAppEnv, withZitadel } from "@zitadel/testing/playwright";

export default defineConfig({
  testDir: "./e2e",
  ...withZitadel({
    configDir: import.meta.dirname,
    port: 8092, // fixed, so the readiness URL is known up front
    appOrigin: "http://localhost:3002", // your app's origin (proxy origin check)
    app: {
      command: ["pnpm", "dev"], // your app's dev server
      cwd: import.meta.dirname,
      readyPath: "/login",
      env: nextAppEnv, // or your own AppEnvTemplate
    },
  }),
});
```

```ts
// my-login.spec.ts
import { expect, loginWithPassword, test } from "@zitadel/testing/playwright";

test("user signs in with password", async ({ page, seed }) => {
  const user = await seed.user(); // unique email + password, loginable now
  await page.goto("/login");
  await loginWithPassword(page, user); // drives the identifier → password steps
  await expect(page).toHaveURL(/\/admin/);
});
```

`app.env` is an `AppEnvTemplate`: a serializable mapping from your app's env
var names to `InstanceHandle` fields. `nextAppEnv` covers `@zitadel/sdk-next`
apps; the console maps the same fields to `VITE_*`/`CONSOLE_*` names instead.
The fixtures find the instance through `ZITADEL_TESTING_HANDSHAKE`, which
`withZitadel()` points at its handshake file.

`app` is optional. Omit it when the instance itself serves the app — the
Zitadel binary embeds the console and hosted sign-in at `/ui/console/` and
`/ui/login/`, so a suite testing those surfaces has no second server to boot.
Only the instance entry is generated, and `appOrigin` must then be the
instance's own local origin:

```ts
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:8092" },
  ...withZitadel({
    configDir: import.meta.dirname,
    port: 8092,
    appOrigin: "http://localhost:8092", // the instance is the app server
  }),
});
```

### Start tests authenticated

Most app tests don't want to re-test login. `authenticatedPage` seeds a user,
drives the real login flow headlessly (the same Flow API the login UI renders),
and injects the resulting session cookie into a dedicated browser context:

```ts
test("member sees the dashboard", async ({ authenticatedPage }) => {
  const { page, user } = authenticatedPage;
  await page.goto("/dashboard"); // already signed in as `user`
});
```

Underneath sits `seed.session()`, whose `sessionToken` also drives session
APIs without any browser — backend tests call the instance directly with the
cookie header (`cookie: __nextgen_session=<sessionToken>`, the SDK
middleware's own headless pattern). Scope: password flows (the shipped
`password-first` presets). A flow step demanding anything beyond the user's
email and password — a challenge, another factor — fails with the step name;
log in through the UI for those. `seed.identity()` complements registration
specs: an unused email+password that creates nothing, so the flow under test
must create the user.

### Drive the login flow

Four ceremony helpers complete whole auth journeys against the
`<zitadel-login>` widget. They are built on the widget's documented
automation hooks (`zitadel-action-*`, `zitadel-field-*` / `zitadel-input-*`),
not on translated button texts, so they survive locale and copy changes:

```ts
import {
  loginWithPassword, // identifier → password (handles combined steps too)
  loginWithPasskey, // identifier-first; or one-tap without an email
  registerWithPassword, // unknown identifier → registration → password path
  registerWithPasskey, // unknown identifier → registration → passkey ceremony
} from "@zitadel/testing/playwright";

await page.goto("/login");
await registerWithPassword(page, { email, password });
// assert your app's signed-in surface — the helpers never assert app state
```

They assume the default flow vocabulary (`submit` / `passkey` /
`passkey_register` actions, `email` and password fields) and branch only on
what the flow renders: flows that require extra registration fields get them
via `profile: [{ field, value }]`, filled when present — a boolean value
drives a checkbox, a string matches a select option or fills a text-like
input. For custom flows or single steps, `flowAction(page, name)` /
`flowField(page, name)` return plain locators for the same hooks, with
`clickFlowAction` / `fillFlowField` as one-line wrappers. Broad fallbacks
(accessible names via `{ name }` / `{ label }`, the generic `data-action`
attribute) are scoped to the `<zitadel-login>` host element — so they never
match same-named controls in your app's own chrome, and they keep working
for custom templates that render no automation hooks.

### Test passkey flows

`enableVirtualPasskey(page)` — also available as the on-demand `passkey`
fixture — attaches a CDP virtual authenticator to the page (a platform
authenticator with discoverable credentials and automatic user presence), so
the real registration and login ceremonies complete without an OS dialog:

```ts
test("registers and signs in with a passkey", async ({ page, seed, passkey }) => {
  const who = seed.identity();
  await page.goto("/login");
  await registerWithPasskey(page, { email: who.email });
  await expect.poll(() => passkey.credentialCount()).toBe(1);
});
```

Constraints, all inherent to WebAuthn/CDP: Chromium projects only (the CDP
WebAuthn domain exists nowhere else); the authenticator is bound to the page,
so register and sign back in on the same page (sign out by clearing cookies
instead of opening a fresh context); and serve the app on an origin WebAuthn
accepts as a relying-party ID — HTTPS on a real domain, or `http://localhost`
for local tests; raw IP origins like `127.0.0.1` are invalid. The default
`password-first` flow offers passkey registration at the registration-choice
step; boot `preset: "passkey-first"` for one-tap discoverable-credential
login flows.

The two in-repo consumers are `apps/demo-next-e2e/playwright.real.config.mts`
and `apps/console-e2e/playwright.real.config.mts` — run them with
`moon run demo-next-e2e:e2e-real` / `moon run console-e2e:e2e-real`.

### Composable pieces

`withZitadel()` is sugar over exported building blocks: a supervisor entry
that calls `startLocalZitadel()` + `writeHandshake()`, and an app-runner entry
that `waitForHandshake()`s and spawns the dev server with
`applyAppEnvTemplate(...)` applied. Suites with unusual topologies (or
non-Playwright runners) compose those functions directly —
`apps/console/scripts/dev-real.mts` does, seeding a dev environment rather
than a test suite.

## API

```ts
import {
  startLocalZitadel, // boot + bootstrap an ephemeral instance
  connectZitadel,    // attach to an existing instance via its handle
  writeHandshake, readHandshakeSync, waitForHandshake,
} from "@zitadel/testing";

const z = await startLocalZitadel({
  port,          // default: free port
  dir,           // default: temp dir, removed on stop (caller dirs are kept)
  appOrigins,    // registered as the project's preview_origins
  useCase,       // "minimal" (default) | "consumer" | "business"
  preset,        // "password-first" (default)
  serverBinary,  // ZITADEL_SERVER_BINARY override (path to a built server binary)
  keep,          // keep the temp dir for debugging
});

z.handle;   // serializable: { baseUrl, projectId, projectSecret, schemaId, previewSecret?, platform? }
z.api;      // authenticated @zitadel/api client (bearer = projectSecret)
z.appEnv;   // { ZITADEL_URL, NEXT_PUBLIC_ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET }
await z.seedUser({ email?, password?, attributes? }); // → { id, email, password }
await z.seedUsers(8, { email?, password?, attributes? }); // per-index templates
z.identity(); // unused { email, password } — creates nothing
await z.seedSession({ user? }); // → { user, sessionToken, expiresAt, cookie }
await z.stop(); // stop server and remove owned temp dir
```

`connectZitadel(handle)` returns the same surface minus lifecycle — this is
what the Playwright fixtures use, and what a future remote-instance mode would
build on.

From `@zitadel/testing/playwright`: the `test`/`expect` fixtures (`seed.user()`
per test, `zitadel` per worker, `passkey` on demand), the flow ceremonies
(`loginWithPassword`, `loginWithPasskey`, `registerWithPassword`,
`registerWithPasskey`) with their locator-level escape hatches
(`flowAction`/`flowField`, `clickFlowAction`/`fillFlowField`), plus
`withZitadel(options)` returning `{ webServer }` for the config,
`enableVirtualPasskey(page)` for non-fixture pages, and
`nextAppEnv`/`applyAppEnvTemplate` for the env-template mechanism described
above.

## How it works

- **Lifecycle** shells out to `zitadel start/stop --json` (the CLI owns port
  preflight, the health wait, and process-group stop). Swapping this for direct
  library calls later will not change the public API.
- **Bootstrap** is the server-side half of `zitadel setup`, no files:
  `POST /projects` (unauthenticated; returns the `project_secret` used as
  bearer for everything else) → `POST /schemas` (server assigns the schema id)
  → `POST /flow_definitions` (default login flow pinned to that schema id).
  Templates come from `@zitadel/config/defaults`.
- **Seeding** is `POST /users` (the body carries `$schema: <schema id>`) +
  `PUT /users/{id}/password` with `is_change_required: false`.

## Credentials: the boot contract

The kit's boot contract is the sanctioned way tests and dev loops obtain
credentials — root ADR 052 §9 (landing with the cross-project-access ADRs,
PR #876) states it directly: "test infrastructure obtains credentials through
the testkit's boot contract rather than through a seed default." The kit owns the
server process and its database, captures each credential from provisioning
output at the moment the server mints it, and exposes it predictably on
`handle`:

- `handle.projectSecret` — the seeded customer project's operator credential,
  captured from `POST /projects` (the server returns it exactly once, at
  creation). Bearer behind `z.api` and every seed op.
- `handle.previewSecret` — the same project's browser-plane credential (the
  publishable-key predecessor from root ADR 036).
- `handle.platform` — the platform-plane slot (`PlatformCredentials`): the
  reserved platform project's id and publishable key, a platform automation
  credential (its concrete form is deferred to a future PAT / service-user
  decision — no wire format exists yet), and a pre-minted operator session.
  **Stub today**: the server's platform-project provisioner (Console ADR 0004
  §2) has not landed, so `startLocalZitadel` never populates it yet. The
  shape is fixed now so fixtures can code against it without churn.

What this rules out, deliberately: there is no server `--test-mode`, no
seed-document credential flag, and no other server-side door that mints
deterministic credentials — and none may be added. The production seed
contract stays credential-free; predictable test access is this kit's job,
done entirely with what provisioning already returns (or, in-repo, with the
kit's own storage access). If a credential the kit needs is not capturable at
provisioning time, the fix is in the kit's boot path, never a server flag.

The in-repo dev loop follows the same contract: `moon run console:dev-real`
boots, seeds, and threads `handle.projectSecret` into the console dev proxy's
`CONSOLE_PROJECT_SECRET` itself; `--seed-only` prints the same variables for
a separately-started dev server. Nothing to remember or export.

## Parallelism model

**One instance per suite, one fresh user per test.** Emails are unique per
project, so per-test `seed.user()` calls are isolation enough for login-flow
tests, and tests run fully parallel against the shared instance
(demonstrated by `demo-next-e2e:e2e-real`, 2 workers).

Typical timings with the SQLite local default (dated estimates from a July 2026 dev build — orders of magnitude, not a benchmark; remeasure locally before relying on them):

| Operation | Time |
| --- | --- |
| Cold boot (fresh data dir: SQLite migrate + health) | typically under a few seconds |
| Warm restart (existing data dir) | typically under a second |
| Stop | typically under a second |
| Bootstrap (project + schema + flow) | ~100ms |
| Seed one user (create + password) | ~50ms |
| Full `e2e-real` suite (boot + Next dev + 2 browser tests) | ~25s |

**Instance-per-worker is not worth it for browser e2e**: the app dev server
boots once with one project's env, and every extra worker would pay the full
cold boot. It becomes interesting for API-level (no-browser) suites that
mutate project-wide state; revisit with warm-dir reuse if that need appears.

## Debugging

- `startLocalZitadel({ keep: true })` keeps the temp dir; the server log is at
  `<dir>/.zitadel/local/server.log`. Boot failures always keep the dir and
  print its path.
- A crashed run can orphan a server: `zitadel stop --all` sweeps every
  CLI-managed runtime on the machine.

## Developing in this repo

Customer installs get the published server binary through `@zitadel/server`'s
platform packages; the in-repo workspace carries no such binary, so the repo's
own suites run `moon run server:build` and point the kit at the result via
`ZITADEL_SERVER_BINARY` (the `withZitadel` option `zitadel.serverBinary` /
`serverBinaryHint` exists for this). Most in-repo moon tasks set
`NEXTGEN_SERVER_LOGIN_ENABLED=false` / `NEXTGEN_SERVER_CONSOLE_ENABLED=false`
because they drive the app-embedded login, not the server-hosted `/ui/*`; the
exception is `console-e2e:e2e-embedded`, which keeps both surfaces on and
omits `app` — the binary-served `/ui/*` pages are its subject. Customer
installs need none of this.

## Known limitations

- `@zitadel/api`'s client stores auth in module-global state; avoid
  interleaving calls to *different* instances within one process. Separate
  processes (Playwright workers) are unaffected.
- macOS/Linux only for now. Not because of the port preflight (it degrades
  gracefully where `lsof` is missing) — the untested surface on Windows is the
  process-group stop for the local binary runtime. Revisit when Windows local
  runtime support is a goal.

## Roadmap

This package is deliberately the **local runtime core** — "Testcontainers for
Zitadel" when the app under test and Playwright share one machine. The layers
on top, in intended order:

1. **Registration fixtures.** Landed: `zitadel.identity()` plus the
   demo-next-e2e registration spec driving the real registration UI and
   verifying the created user through the API. `cli-journey-e2e` keeps the
   packaged-product registration coverage.
2. **Email/OTP capture.** `zitadel.email.waitForCode(address)` for
   verification flows. Blocked on a server-side story (dev SMTP sink or
   API-exposed codes); password-only flows don't hit this.
3. **Vitest surface.** Landed from this item: `withZitadel(config)`
   orchestration, `AppEnvTemplate`/`nextAppEnv`, and the session-mint seed-op
   (`seed.session()` driving the real flow headlessly, `authenticatedPage` on
   top). Remaining: a dedicated `@zitadel/testing/vitest` entry once a second
   backend consumer exists — `sessionToken` already serves backend tests
   directly.
4. **Remote mode: ephemeral project on a persistent instance.** For app
   deployments that cannot reach a local process (preview environments).
   `bootstrapProject({ baseUrl })` + `connectZitadel(handle)` already compose
   into this today; formalizing it means cleanup semantics and docs.
5. **Vercel Sandbox runtime.** A publicly reachable ephemeral instance per
  preview deployment (e.g. `@zitadel/testing/vercel`), returning the same
  `InstanceHandle` so fixtures don't change. Gated on a spike: SQLite (or
  another Sandbox-friendly store) on the Sandbox image, forwarded proto/host
  handling, secure cookies + issuer + handoff verification through
  `sandbox.domain()`, registering the preview URL as an allowed origin
  post-deploy (`PATCH /projects`), and cleanup that survives failed runs.
6. **Publishing.** Landed: the consumer journey installs the kit the way a
  customer would in CI, and the kit ships on the release train (release
  manifest + changeset `fixed` group), versioned in lockstep with
  `@zitadel/cli`. Remaining: the Windows decision for the local binary
  runtime and the stability commitment when the train leaves alpha.

Parked until server support exists: passkey *seeding* (pre-registered WebAuthn
credentials) — UI-driven passkey ceremonies are covered today by
`enableVirtualPasskey`. Independent refactor: extract
`apps/cli/src/lib/local-server` into a shared package and swap the lifecycle
shell-out for imports.
