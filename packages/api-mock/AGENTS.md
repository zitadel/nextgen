# Agent Instructions — `packages/api-mock`

`@zitadel/api-mock` stands in for the Zitadel API: MSW handlers for the typed
`@zitadel/api` Flow API and the platform API, and a standalone server built on
the same handlers. Storybook, the component, SDK and CLI tests use it in
process; the demos run the server (`moon run api-mock:start`).

It is not published, but it builds to `dist/` (tsdown) like every package:
consumers resolve its export map (`@zitadel/source` points in-repo tooling at
the source) and depend on `api-mock:build`.

## The flow shape mirrors the real default flow

A mock flow that drifts from the server's makes every consumer prove the wrong
thing. The authority is
[`packages/config/defaults/default-login.json`](../config/defaults/default-login.json),
which the server embeds (`configdefaults.DefaultLoginFlowDefinition()`).

- Diff a step fixture against that JSON before changing it.
  `src/fixtures/default-conformance.spec.ts` fails a fixture that misses a
  declared action or grows one beyond its documented allowlist.
- Never invent a step shape for a test or a design: the flow definition
  changes first.
- Sign-in is split: `identifier` → `password` → `done`, never a combined
  email-and-password card.
- Credential fields are keyed by the schema pointer `x-auth-methods#password`
  (`PASSWORD_FIELD`), never `"password"`, which the server refuses with
  `req.invalid`.
- The steps `zitadel auth-method sso enable` adds (`register-sso`,
  `sso-conflict`) follow
  [`default-login.scaffold.json`](../../docs/design/idp/schemas/default-login.scaffold.json),
  which the CLI's `applySsoToFlow` test keeps in step with the generator.
- The documented exceptions: `identifier` keeps a `recover` navigate (the
  default flow has no recovery step yet); `passkey-upsell`/`passkey-setup`
  stay for direct actor injection; `register-sso` serves
  `given_name`/`family_name` and a `sign_in` navigate where the scaffold
  collects `email` with one `submit`.

## Architecture

- The xstate machine (`src/flow-machine.ts`) picks the step. Its state names,
  the `FlowStepName` union, are the wire step names; there is no mapping.
- Fixtures (`src/fixtures/login.ts`) return orval's `CreateFlow201`, which is
  structurally the get and submit responses too, so one set serves all three
  handlers (`src/handlers.ts`). Never declare shadow step, field or branding
  types.
- Only `setupMock(worker)` and the test-only `./vitest-browser` harness may
  use `msw/browser`: the same handlers must run in node.

## Adding a flow step

1. Add a state named as on the wire to `src/flow-machine.ts`, wire it into its
   `SUBMIT` transition, and add the name to `FlowStepName`.
2. Add a fixture builder returning `CreateFlow201` to `src/fixtures/login.ts`
   (or a sibling for other flows), wrapped with `wrap(...)`.
3. Add its `case` to `currentResponse()` in `src/handlers.ts`.
4. Walk the new branch through the typed orval client in `src/index.spec.ts`.

## Fixtures for error paths

Emails that trigger error paths (`REGISTRATION_ERRORS`, `LOGIN_ERRORS`,
`PASSKEY_UPSELL_ERRORS`) are in `src/lib/authn/authn-store.ts`; any other email
takes the happy path, unless `setupMockHandlers({ accounts })` opts into the
default flow's switch between sign-in and sign-up (its JSDoc has the rules).

## The provider's return

- The `sso` submit answers `sso-redirect` and records the submission's
  `return_target`. As on the engine (`internal/api/flow.go`), the target must
  pass `parseRedirectTarget` (`src/redirect-target.ts`, a port of
  `httputil.ParseRedirectTarget`) and be on the request origin, or the submit
  is refused with `req.invalid`, so a client the server would refuse fails
  against the mock too.
- The refused and accepted targets are one list,
  `internal/httputil/testdata/redirect_targets.json`, read by the Go tests and
  `src/redirect-target.spec.ts`. A new way around the check goes there and
  into both implementations.
- The return is `GET /__nextgen/idp/callback` (or `/idp/callback`), not a
  submit, as on the engine (`internal/api/idp_callback.go`): its query
  (`code`, `email`, `error`) decides the next step, and it answers with a
  `303` to the recorded target. `returnFromProvider(...)` drives the same
  transition in process.

## Branding

- `applyBranding(...)` overlays every response; clear it between tests with
  `clearBranding()`. Its type stays open (`CreateFlow201Branding &
  Record<string, unknown>`) so this package never depends on the components'
  types.
- `createMockApp({ issuer })` (`src/server.ts`, the `./server` export) applies
  `defaultDevBranding` on boot. `setupMockHandlers()` / `setupMock()` apply
  nothing unless the caller does.

## Testing

- `pnpm test` runs both Vitest projects: `unit` (node, `*.spec.ts`) and
  `browser` (Chromium, `*.browser.spec.ts`; needs
  `pnpm exec playwright install`). `pnpm test:unit` is the fast lane.
- `src/index.spec.ts` is the handlers' contract: for a step-routing
  regression, add its case there first.
