# api-mock Agent Notes

Scoped instructions for `packages/api-mock/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

`@zitadel-nextgen/api-mock` is a workspace-internal MSW handler library
for the typed `@zitadel-nextgen/api` Flow API. Consumers:

- `packages/components/dev/main.ts` — boots the worker for the dev
  playground.
- `packages/components/src/orchestrator/zitadel-login.spec.ts` — feeds
  the handlers into `msw/node`'s `setupServer`.
- `apps/demo-next/` and `apps/demo-nuxt/` — hit the standalone TCP server
  started by `pnpm --filter @zitadel-nextgen/api-mock start` (not an
  in-browser worker).

It is **not** published. There is no built artifact; consumers import
the source directly via the workspace export map.

## Architecture

```
xstate flowMachine (src/flow-machine.ts)
   ↓ snapshot.value picks the next step
fixtures (src/fixtures/login.ts)        — orval-typed CreateFlow201 builders
   ↓ withBranding(...) overlay
handlers (src/handlers.ts)              — orval `getCreateFlowMockHandler` etc.
   ↓
setupMock(worker) / setupMockHandlers() (src/index.ts)
```

Every step fixture returns the orval `CreateFlow201` shape. There are
no shadow step types — fixtures import from
`@zitadel-nextgen/api/generated/model` and the structural identity of
the three orval response aliases (`CreateFlow201`, `GetFlowStep200`,
`SubmitFlowStep200`) lets a single fixture set drive all three handlers.

## Adding a new flow step

State names in the xstate machine **are** the canonical wire step names
(`identifier`, `register`, `recover`, `password`, `passkey-login`, `passkey-upsell`, `passkey-setup`, `sso-redirect`, `done`) — no
mapping function. To add a step:

1. Add a state to the machine in `src/flow-machine.ts` named exactly as
   it appears on the wire, and wire it into the relevant `SUBMIT`
   transition. Add the name to the `FlowStepName` union.
2. Add a fixture builder in `src/fixtures/login.ts` (or a sibling file
   for non-login flows). Builder must return `CreateFlow201` typed from
   orval; use `wrap(...)` for the standard envelope.
3. Add a `case` in `currentResponse()` in `src/handlers.ts` that calls
   the new fixture.
4. Add a walk test in `src/index.spec.ts` that exercises the typed
   orval client through the new branch.

## Dev fixture emails

`src/handlers.ts` recognizes special emails for the components login
playground (`http://localhost:5173/?route=login`). The sidebar there
documents the same table.

| When | Email | Result |
|------|-------|--------|
| Sign in submit | `wrong@example.com` | Stays on identifier; `error.invalid_credentials` on password |
| Sign in submit | `server@example.com` | Stays on identifier; `error.sign_in_server` form alert |
| Sign up submit | `exists@example.com` | Stays on register; `error.email_exists` on email |
| Passkey upsell, action `setup` | `passkey-cancel@example.com` (captured from sign-in) | Stays on passkey-upsell; `error.passkey_cancelled` |
| Passkey upsell, action `setup` | `passkey-unsupported@example.com` | `error.passkey_unsupported` |
| Passkey upsell, action `setup` | `passkey-fail@example.com` | `error.passkey_failed` |

Happy path: any other email → identifier/register → passkey-upsell → passkey-setup → `done`.

## Branding

`applyBranding(branding)` writes a module-level overlay merged into
every response. The overlay type is `CreateFlow201Branding &
Record<string, unknown>`: the wire baseline gets full TS guidance, and
the open record allows orchestrator-side v2 extension fields
(`palette`, `typography`, `shape`, `assets`, `theme`) without making
this package depend on the components type surface. The orchestrator's
branding-validator strips anything the OpenAPI doesn't model. Tests
should clear the overlay between cases via `clearBranding()`.

The standalone TCP server (`startMockServer` in `src/server.ts`) calls
`applyBranding(defaultDevBranding)` on boot so demo apps receive a
baseline `font_url` (Google Fonts Arimo) without extra setup. The payload
lives in `src/default-dev-branding.ts` and mirrors
`docs/design/branding/branding.example.json`. MSW-only consumers
(`setupMockHandlers` / `setupMock`) do **not** get this overlay unless
they call `applyBranding` themselves — same as before.

## Testing

Two Vitest projects, mirroring `packages/components`:

- `unit` — node mode against `msw/node`'s `setupServer`. Picks up
  `*.spec.ts`. The end-to-end walk in `src/index.spec.ts` is the
  canonical contract test for the handlers and is what CI runs as
  `pnpm test`.
- `browser` — real Chromium via Playwright against `msw/browser`'s
  `setupWorker`. Picks up `*.browser.spec.ts`. `index.browser.spec.ts`
  smoke-tests the `setupMock(worker)` entry point that the dev
  playground uses. Runs locally via `pnpm test:browser` and requires a
  Playwright browser install (`pnpm exec playwright install`); skipped
  in CI to keep the runner image lean.

`pnpm test:all` runs both projects. When fixing a regression in step
routing, add a case to the unit spec first — that is what CI gates on.

## Don't

- Don't introduce shadow types for step / field / branding shapes. Use
  orval's `CreateFlow201*` aliases directly.
- Don't depend on `msw/browser` from anything other than the
  `setupMock(worker)` entry point — the same handlers must work in
  node.
- Don't ship a build target. The `nx:noop` build is intentional —
  consumers import source via the workspace export map.
