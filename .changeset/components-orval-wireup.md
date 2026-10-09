---
"@zitadel/components": minor
---

Wire `<zitadel-login>` and `<zitadel-logout>` to the orval-generated
`@zitadel/api` typed fetch client and consolidate flow mocking
into the new workspace-internal `@zitadel/api-mock` package.

The previous `FlowTransport` abstraction (and its `FetchTransport` /
`FixtureTransport` / `WalkingFixtureTransport` / `ProxyTransport`
implementations) is gone. So is the wire/internal type split — the
orchestrator stores the orval `CreateFlow201` directly and the
`adaptResponse` boundary is gone. Tests intercept at the network layer
with MSW.

Removed exports from `@zitadel/components` (and the
`./orchestrator` subpath barrel):

- `FetchTransport`, `FixtureTransport`, `WalkingFixtureTransport`,
  `ProxyTransport`
- `FlowTransport`, `FlowTransportError`, `FixtureScript`,
  `FetchTransportOptions`, `ProxyTransportOptions`,
  `WalkingFixtureOptions`
- `FlowDefinition`, `FlowDefinitionStep`, `FlowTransitionTarget`,
  `StartInput`
- `FlowApiResponse`, `StartFlowInput`, `SubmitFlowInput`,
  `FlowStartInput`, `FlowSubmitInput`, `FlowResponse`, `FlowStep`,
  `FlowField`, `FlowAction`, `FlowGate`, `FlowSsoProvider`,
  `FlowFieldType`, `FlowPurpose`, `FlowStepComplete` — the wire shape
  comes from `@zitadel/api/generated/model` directly; consumers
  who need it should import from there.
- The `@zitadel/components/orchestrator/transport` subpath
  export.

Retained exports (now sourced from the dedicated `branding.ts` and
`template-context.ts` modules):

- `Branding`, `BrandingPalette`, `BrandingShape`, `BrandingTheme`,
  `BrandingTypography`, `BrandingAssets`, `FlowLayout`,
  `BrandingValidationResult`.
- `FlowMessage`, `FlowIdentity`, `FlowError`, `LiquidContext` — the
  Liquid template context contract for tenant templates.

Removed attributes/properties on `<zitadel-login>`:

- `transport`, `base-url`, `proxy-base`. Configure the API base URL
  with `setApiBaseUrl()` from `@zitadel/api/runtime/base-url`,
  or use the new `api-base` attribute for declarative setups. A new
  `resume-flow-id` attribute resumes an existing flow handle.

Removed attributes on `<zitadel-logout>`:

- `proxy-base`.
- `client-id`. The OIDC end-session surface is not part of the
  OpenAPI contract, so the element no longer exposes
  `getEndSessionUrl()`. Sign-out calls the typed `revokeMySession`
  operation (`DELETE /sessions/me`) and then navigates to
  `post-sign-out-url`.

Behaviour changes:

- `<zitadel-login>` emits a new `zitadel-flow-complete` CustomEvent on
  terminal steps with `{ behavior, redirect_uri?, handoff_token? }`.
  For `complete: "redirect"` it follows `redirect_uri`; for
  `complete: "show"` it falls back to the optional `post-sign-in-url`.
- The submit body now matches the OpenAPI contract:
  `{ session_token, action, fields, gate_proofs?, sso_provider_id? }`
  posted to `/flow/{id}/submit`. The orchestrator re-reads the `id`
  from every response to track flow pivots and pops, and runs all
  calls with `credentials: "include"` so the stateless `_zflow`
  cookie round-trips.

Mocking workflow:

- The dev playground and unit tests both consume
  `@zitadel/api-mock` (`setupMock` for browser worker
  callers, `setupMockHandlers` for `msw/node`). The mock walks an
  `xstate` flow machine through identifier → password → done (with
  register and SSO branches) and exposes `applyBranding`,
  `getCapturedRequests`, and `resetFlow` helpers. The previous
  hand-rolled `dev/mock-flow-server.ts` is gone.
