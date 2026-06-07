# @zitadel/components

## 0.1.0-alpha.0

### Minor Changes

- [#45](https://github.com/zitadel/nextgen/pull/45) [`c82ed55`](https://github.com/zitadel/nextgen/commit/c82ed5564e949bf8fe73f449db9a2718b50e7edf) Thanks [@bastionstack](https://github.com/bastionstack)! - Add the first publishable surface of `@zitadel/components`:
  - The Lit-based atom substrate (`<zl-field>`, `<zl-submit>`, `<zl-action>`, `<zl-error>`) with manifests, parts, slots and the `zl-input` / `zl-submit` / `zl-action` CustomEvents that the orchestrator listens for.
  - A `--zl-*` token catalogue, base shadow-host styles and a focus-ring helper consumed by all atoms.
  - The `<zitadel-login>` orchestrator: open Shadow DOM, branding-to-tokens via `adoptedStyleSheets` (light/dark), pluggable `FlowTransport` (`FetchTransport`, `FixtureTransport`), DOMPurify allowlist for `zl-*`, font-url loader, branding shape validator, and a LiquidJS engine with banned `| raw`, the `| t` filter and the `{% mandatory_gates %}` patcher.
  - Bundled `default.liquid` + `auth_form.liquid` partials for centered and split layouts, plus an `en` locale stub.
  - Subpath exports for `./atoms`, `./manifests`, `./tokens`, `./orchestrator` and `./orchestrator/transport`.

- [#86](https://github.com/zitadel/nextgen/pull/86) [`0fa3fc9`](https://github.com/zitadel/nextgen/commit/0fa3fc9a5ec7f85f8d5ab771737e87decab8b404) Thanks [@bastionstack](https://github.com/bastionstack)! - Wire `<zitadel-login>` and `<zitadel-logout>` to the orval-generated
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

  Removed attribute on `<zitadel-logout>`:
  - `proxy-base`. The element now calls the typed `endSession`
    operation (`GET /auth/end-session`) and forwards `client-id` /
    `post-sign-out-url` as query parameters.

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

- [#73](https://github.com/zitadel/nextgen/pull/73) [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69) Thanks [@bastionstack](https://github.com/bastionstack)! - Replace the `@nextgen/ui-lit` placeholder web components with the real
  `@zitadel/components` library across the demos and SDK packages.
  - Add `<zitadel-logout>`: an orchestrator-tier element built on the same
    design-token system as `<zitadel-login>`. It reads the `__nextgen_display`
    cookie, renders an avatar trigger + dropdown by default, and supports a
    `<template>`-slot mode with `{{name}}`, `{{email}}`, `{{initial}}`
    substitutions and `data-action="logout"` triggers. Fires `zitadel-signout`
    on completion.
  - Add `proxy-base` and `post-sign-in-url` attributes to `<zitadel-login>`.
    When `proxy-base` is set the orchestrator drives a new `ProxyTransport`
    against the SDK's `/__nextgen` proxy; `post-sign-in-url` navigates after a
    terminal step. `<zitadel-logout>` exposes `proxy-base` and
    `post-sign-out-url` for the symmetric flow.
  - Add `ProxyTransport`: a same-origin transport that speaks the
    `/v1/flow {action,email,password}` shape exposed by the
    `feat/sdk-packages` mock server / SDK proxy. Synthesises a single-step
    `FlowResponse` with `email` + `password` fields so the existing
    orchestrator + atom pipeline renders against it unchanged.
  - Drop the `@nextgen/ui-lit` package and switch `@zitadel/sdk-next`,
    `@zitadel/sdk-nuxt`, and the `apps/demo-next` / `apps/demo-nuxt` apps to
    re-export and consume `@zitadel/components` instead. Existing
    `<nextgen-login>` / `<nextgen-logout>` tags become `<zitadel-login>` /
    `<zitadel-logout>` with the same `proxy-base` and post-sign-{in,out}-url
    attributes.

- [#116](https://github.com/zitadel/nextgen/pull/116) [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba) Thanks [@bastionstack](https://github.com/bastionstack)! - Introduce the design-token-driven foundation for the auth surface, replacing
  the demo styling baseline:
  - New `@zitadel/design-tokens` package — the single producer of the
    `--zl-*` CSS variable layer, the typed `tokens` / `cssVars` constants,
    and the Tailwind v4 `@theme` block. Backed by a version-pinned
    `figma-tokens.lock`, a Figma REST sync script, and a manual-trigger
    GitHub workflow that opens PRs with regenerated outputs. A snapshot
    test locks the public token surface.
  - New `@zitadel/ui-react` package — visually identical paired React components
    of every Lit atom (`<Button>`, `<TextField>`, `<Alert>`, `<Pill>`,
    `<Icon>`, `<Card>`, `<PageShell>`). Used by the internal Zitadel console
    and ships a single `styles.css` that consumes the design-token variables.
  - `@zitadel/components`:
    - Drop the legacy `<zl-submit>`, `<zl-action>`, `<zl-error>` atoms and
      the hand-rolled `src/tokens/` catalogue.
    - Add `<zl-button>` (full Figma matrix, form-associated), `<zl-alert>`,
      `<zl-pill>`, `<zl-icon>`, `<zl-card>`, `<zl-page-shell>`. Rebuild
      `<zl-field>` against the Figma Text Field spec.
    - Add `passkey-upsell` and `signed-in` Liquid templates and rewrite the
      default + auth-form templates to compose `<zl-page-shell>` →
      `<zl-card>` with the new atoms.
    - Rewrite `branding-to-tokens` to fan branding palette/density/radius
      onto the new `--zl-*` namespace and add `branding.attribution` for
      "Secured with Zitadel" footer control. Default theme switches from
      light to dark to match the published Figma variable mode.

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire up the end-to-end passkey registration and login flow across the
  API, component, and SDK surfaces:
  - `@zitadel/api`: expose the passkey registration OpenAPI contract to the
    generated TypeScript client.
  - `@zitadel/components`: refresh the `<zl-passkey>` atom and the
    `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
    `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
    partials) and expand the `en`/`de` locale strings for the passkey steps.
  - `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
    passkey register/login round-trip.
  - `@zitadel/sdk-core`: adjust JWT handling to support the flow.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Document the default fresh-app credential journey and refine the component copy
  and password autocomplete behavior for registration flows.

- [#223](https://github.com/zitadel/nextgen/pull/223) [`8a8d417`](https://github.com/zitadel/nextgen/commit/8a8d417923754d58c3967839ebc9ebf84154531b) Thanks [@peintnermax](https://github.com/peintnermax)! - exchange auth header and form-associated name property
