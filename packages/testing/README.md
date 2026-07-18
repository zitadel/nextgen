# @zitadel/testing

Test-kit for **seeded ephemeral local Zitadel instances**: boot the real server
(binary runtime + embedded Postgres, no Docker) from test code, create a
project with the default login flow, and mint password users that can complete
the real login journey immediately.

> **Status: POC.** Private, in-repo only. The public API validates the
> "auth in code" L2 shape; publishing to npm is a separate, deliberate step
> (see [Future work](#future-work)).

## Why

The repo previously had two extremes: the demo e2e suites run against
`@zitadel/api-mock` (fast, but fake — no user store, no real crypto), and
`cli-journey-e2e` runs the real packaged product but creates users by clicking
through the registration UI, serialized per suite. This kit fills the middle:
**real server, programmatic seeding, parallel-safe per-test users.**

## Quick start (Playwright)

Boot + bootstrap once per suite (a Playwright `webServer`), seed per test:

```ts
// scripts/boot-zitadel.mts — webServer entry, stays in the foreground
import { startLocalZitadel, writeHandshake } from "@zitadel/testing";

const zitadel = await startLocalZitadel({
  port: 8092,
  appOrigins: ["http://localhost:3002"], // your app's origin (proxy origin check)
});
await writeHandshake(".zitadel-testing/handshake.json", zitadel.handle);
process.on("SIGTERM", () => void zitadel.stop().finally(() => process.exit()));
setInterval(() => {}, 60_000);
```

```ts
// my-login.spec.ts
import { expect, test } from "@zitadel/testing/playwright";

test("user signs in with password", async ({ page, seed }) => {
  const user = await seed.user(); // unique email + password, loginable now
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
});
```

The fixtures read `ZITADEL_TESTING_HANDSHAKE` (path to the handshake file) to
connect. See `apps/demo-next-e2e/playwright.real.config.mts` for the complete
working wiring, including the app-dev-server wrapper that injects
`zitadel.appEnv` — run it with `moon run demo-next-e2e:e2e-real`.

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
  appOrigins,    // registered as the project's previewOrigins
  useCase,       // "minimal" (default) | "consumer" | "business"
  preset,        // "password-first" (default)
  serverBinary,  // ZITADEL_SERVER_BINARY override (in-repo: dist/server/nextgen)
  keep,          // keep the temp dir for debugging
});

z.handle;   // serializable: { baseUrl, projectId, projectSecret, schemaId, previewSecret? }
z.api;      // authenticated @zitadel/api client (bearer = projectSecret)
z.appEnv;   // { ZITADEL_URL, NEXT_PUBLIC_ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET }
await z.seedUser({ email?, password?, attributes? }); // → { id, email, password }
await z.stop(); // stop server, reap embedded Postgres, remove owned temp dir
```

`connectZitadel(handle)` returns the same surface minus lifecycle — this is
what the Playwright fixtures use, and what a future remote-instance mode would
build on.

## How it works

- **Lifecycle** shells out to `zitadel start/stop --json` (the CLI owns port
  preflight, the health wait, process-group stop, and embedded-Postgres
  reaping). Swapping this for direct library calls later will not change the
  public API.
- **Bootstrap** is the server-side half of `zitadel setup`, no files:
  `POST /projects` (unauthenticated; returns the `projectSecret` used as
  bearer for everything else) → `POST /schemas` (server assigns the schema id)
  → `POST /flow_definitions` (default login flow pinned to that schema id).
  Templates come from `@zitadel/config/defaults`.
- **Seeding** is `POST /users` (the body carries `$schema: <schema id>`) +
  `PUT /users/{id}/password` with `isChangeRequired: false`.

## Parallelism model

**One instance per suite, one fresh user per test.** Emails are unique per
project, so per-test `seed.user()` calls are isolation enough for login-flow
tests, and tests run fully parallel against the shared instance
(demonstrated by `demo-next-e2e:e2e-real`, 2 workers).

Measured on an arm64 macBook (dev build, July 2026):

| Operation | Time |
| --- | --- |
| Cold boot (fresh data dir: initdb + migrations + health) | ~20–27s |
| Warm restart (existing data dir) | ~15s |
| Stop incl. embedded-Postgres reap | ~12s |
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

## Known limitations (POC)

- `@zitadel/api`'s client stores auth in module-global state; avoid
  interleaving calls to *different* instances within one process. Separate
  processes (Playwright workers) are unaffected.
- Requires the in-repo server binary (`moon run server:build`) via
  `ZITADEL_SERVER_BINARY`; the npm platform packages carry no binary in-repo.
- macOS/Linux only (the CLI's port preflight uses `lsof`).

## Roadmap

This package is deliberately the **local runtime core** — "Testcontainers for
Zitadel" when the app under test and Playwright share one machine. The layers
on top, in intended order:

1. **Registration fixtures.** `zitadel.identity()` (mint an unused identity
   *without* creating the user) plus a spec that drives the real registration
   UI and verifies the created user through the API. Until then,
   `cli-journey-e2e` keeps covering registration.
2. **Email/OTP capture.** `zitadel.email.waitForCode(address)` for
   verification flows. Blocked on a server-side story (dev SMTP sink or
   API-exposed codes); password-only flows don't hit this.
3. **`withZitadel(config)` orchestration.** A Playwright-config adapter that
   owns the boot supervisor, handshake, app-env injection, and teardown so
   consumers stop writing webServer wrapper scripts — plus framework-neutral
   `appEnv` naming with per-SDK adapters (today's names are Next-shaped), and
   a session-mint seed-op (authenticated session/token for a seeded user) so
   backend tests can skip the browser and a vitest surface earns its keep.
4. **Remote mode: ephemeral project on a persistent instance.** For app
   deployments that cannot reach a local process (preview environments).
   `bootstrapProject({ baseUrl })` + `connectZitadel(handle)` already compose
   into this today; formalizing it means cleanup semantics and docs.
5. **Vercel Sandbox runtime.** A publicly reachable ephemeral instance per
   preview deployment (e.g. `@zitadel/testing/vercel`), returning the same
   `InstanceHandle` so fixtures don't change. Gated on a spike: embedded
   Postgres on the Sandbox image, forwarded proto/host handling, secure
   cookies + issuer + handoff verification through `sandbox.domain()`,
   registering the preview URL as an allowed origin post-deploy
   (`PATCH /projects`), and cleanup that survives failed runs.
6. **Publishing.** Peer-dep story for `@zitadel/cli` and `@playwright/test`,
   entries in the release manifest and the changeset `fixed` train, Windows
   support (the CLI port preflight shells `lsof`), and the semver commitment
   — after the API has survived a second in-repo consumer.

Parked until server support exists: passkey seeding (pre-registered WebAuthn
credentials). Independent refactor: extract `apps/cli/src/lib/local-server`
into a shared package and swap the lifecycle shell-out for imports.
