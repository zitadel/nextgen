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
- Future consumers (apps/console, demo apps) that want a local mock.

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
(`identifier`, `register`, `password`, `sso-redirect`, `done`) — no
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

## Branding

`applyBranding(branding)` writes a module-level overlay merged into
every response. The overlay type is `CreateFlow201Branding &
Record<string, unknown>`: the wire baseline gets full TS guidance, and
the open record allows orchestrator-side v2 extension fields
(`palette`, `typography`, `shape`, `assets`, `theme`) without making
this package depend on the components type surface. The orchestrator's
branding-validator strips anything the OpenAPI doesn't model. Tests
should clear the overlay between cases via `clearBranding()`.

## Testing

`pnpm vitest run` runs the spec in real Chromium via
`@vitest/browser-playwright`. The end-to-end walk in
`src/index.spec.ts` exercises the typed orval client against an in-page
`setupWorker(...setupMockHandlers())` — it is the canonical contract
test. When fixing a regression in step routing, add a case there before
touching the consumers in `packages/components`.

## Don't

- Don't introduce shadow types for step / field / branding shapes. Use
  orval's `CreateFlow201*` aliases directly.
- Don't depend on `msw/browser` from anything other than the
  `setupMock(worker)` entry point — the same handlers must work in
  node.
- Don't ship a build target. The `nx:noop` build is intentional —
  consumers import source via the workspace export map.
