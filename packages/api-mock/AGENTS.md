# api-mock Agent Notes

Scoped instructions for `packages/api-mock/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

`@zitadel/api-mock` is a workspace-internal MSW handler library
for the typed `@zitadel/api` Flow API. Consumers:

- `apps/storybook` — the `Orchestrator/Login` stories boot the worker
  through `msw-storybook-addon`.
- `packages/components/src/orchestrator/zitadel-login.spec.ts` — feeds
  the handlers into `msw/node`'s `setupServer`.
- `apps/demo-next/` and `apps/demo-nuxt/` — hit the standalone TCP server
  started by `pnpm --filter @zitadel/api-mock start` (not an
  in-browser worker).

It is **not** published. There is no built artifact; consumers import
the source directly via the workspace export map.

## The flow shape must mirror the real default flow

This mock is the substrate for the orchestrator's own test suite, the Storybook
stories, and the demo e2e suites. When its flow shape diverges from the server's,
every one of those consumers silently proves the wrong thing.

The authority is
[`packages/config/defaults/default-login.json`](../config/defaults/default-login.json),
embedded into the server via `configdefaults.DefaultLoginFlowDefinition()`. Two
properties it fixes, both of which this mock got wrong until they were corrected:

- **Sign-in is split**: `identifier` (email) → `password` → `done`. It is not a
  combined email+password card. The mock served a combined card for a long time,
  so the orchestrator's tests, the Storybook story, and both demo e2e suites were
  all walking a screen the server never emits.
- **Credential fields are keyed by the schema pointer** `x-auth-methods#password`
  (exported as `PASSWORD_FIELD`), on both `password` and `register-password`. The
  server answers `req.invalid` to a submit keyed on plain `password`, so the short
  name let the orchestrator send a key the real backend refuses — invisible to
  every mock-backed test.

Two knowing, documented exceptions: the `identifier` step keeps `register` and
`recover` navigate actions (the real flow reaches register via the engine's
`user_not_found` transition and has no recovery step yet) so those screens stay
reachable, and the `passkey-upsell`/`passkey-setup` pair is retained for direct
actor injection though the default flow no longer routes through it.

**Before changing a step fixture, diff it against that JSON.** If a design or
test needs a shape the server does not emit, the flow definition changes first.

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
`@zitadel/api/generated/model` and the structural identity of
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

`src/handlers.ts` recognizes special emails for the `Orchestrator/Login`
Storybook stories (`moon run storybook:dev`). The story docs note the same
table.

| When | Email | Result |
|------|-------|--------|
| Sign in submit | `wrong@example.com` | Stays on identifier; `error.invalid_credentials` on password |
| Sign in submit | `server@example.com` | Stays on identifier; `error.sign_in_server` form alert |
| Sign up submit | `exists@example.com` | Stays on register; `error.email_exists` on email |

Happy path: any other email → identifier/register → `done`. The
`passkey-upsell` / `passkey-setup` states still exist in the machine but are
no longer routed to by the default paths (passkey registration is offered up
front instead); their fixture emails (`passkey-cancel@…`, `passkey-unsupported@…`,
`passkey-fail@…`) only matter for tests that inject those states directly.

## Branding

`applyBranding(branding)` writes a module-level overlay merged into
every response. The overlay type is `CreateFlow201Branding &
Record<string, unknown>`: the wire baseline gets full TS guidance, and
the open record allows orchestrator-side v2 extension fields
(`palette`, `typography`, `shape`, `assets`, `theme`) without making
this package depend on the components type surface. The orchestrator's
branding-validator strips anything the OpenAPI doesn't model. Tests
should clear the overlay between cases via `clearBranding()`.

`src/server.ts` exposes two functions. `createMockApp({ issuer })` builds
the configured Express app and returns it without binding a port; it
calls `applyBranding(defaultDevBranding)` on boot so demo apps receive a
baseline `font_url` (Google Fonts Arimo) without extra setup.
`startMockServer(port)` wraps it for the standalone TCP server (deriving a
localhost issuer from `port`). The bare app is published via the
`./server` export so a serverless host can use it directly as a request
handler — see `apps/mock-zitadel`, which serves it as per-PR Vercel
previews. The branding payload lives in `src/default-dev-branding.ts` and
mirrors `docs/design/branding/branding.example.json`. MSW-only consumers
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
  smoke-tests the `setupMock(worker)` browser entry point. Runs locally
  via `pnpm test:browser` and requires a
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
- Don't ship a build artifact. Consumers import source via the workspace
  export map; the Moon build task is intentionally a no-op.
- Don't invent a step shape to make a test or a design convenient. The flow
  definition is the authority — see the section above.
- Don't hard-code `"password"` as a field name. Import `PASSWORD_FIELD`.
