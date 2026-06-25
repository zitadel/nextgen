# @zitadel/components

## 0.1.0-alpha.12

### Minor Changes

- [#390](https://github.com/zitadel/nextgen/pull/390) [`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333) Thanks [@bastionstack](https://github.com/bastionstack)! - Add the `Checkbox` and `Select` atoms in both renderers, and render the
  `checkbox` and `select` field types in the orchestrator.
  - `@zitadel/components`:
    - New form-associated `<zl-checkbox>` Lit atom (Figma `Checkbox` `4387:460`,
      `Checkbox / With Label` `6634:1868`): optional `label` (or default slot),
      `checked` / `disabled` / `required` / `value` / `name`, a `zl-change` event,
      and full form participation (`setFormValue` / `setValidity` / reset / focus
      delegation).
    - New form-associated `<zl-select>` Lit atom (Figma `Dropdown` `4397:4816`,
      `Input text` `4397:4098`): a select-only combobox following the WAI-ARIA
      pattern with keyboard navigation. Options accept either a JS array
      (`.options`) or a JSON `options` attribute; `value` / `placeholder` /
      `disabled` / `required` and a `zl-change` event.
    - New `chevron-down` icon.
    - Both atoms registered in the manifest registry.
    - Orchestrator: the default Liquid template now renders `select` and
      `checkbox` field types as `<zl-select>` / `<zl-checkbox>`; select options
      are built from the field's `validation.enum` via a new `selectOptions`
      filter.
  - `@zitadel/ui-react`: new paired `<Checkbox>` and `<Select>` React components
    that mirror the Lit atoms' DOM and share their surface CSS.

  Shared `checkbox.css` and `select.css` (+ their `lit/*-host.css`) were added to
  `@zitadel/shared-component-styles`. No new design tokens were required.

### Patch Changes

- [#337](https://github.com/zitadel/nextgen/pull/337) [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051) Thanks [@bastionstack](https://github.com/bastionstack)! - Scaffolded app pages now enforce the dark surface the Zitadel widgets are designed for (`color-scheme: dark`, `#0f0f11`), instead of following the OS light/dark setting — across every framework template (`next`, `react`, `vue`, `angular`, `nuxt`, `solid`, `svelte`, `qwik`). This fixes the inconsistency where the `<zitadel-logout>` avatar (and other non-widget chrome, e.g. the `/profile` view) rendered on a white background while `<zitadel-login>` enforced its own dark surface.

  Removed misleading field hints from the login component locales (`en`, `de`, `it`): the password "include a symbol and number" hint (only `minLength` is enforced server-side) and the `YYYY-MM-DD` date-of-birth hint (native `<input type="date">` localizes its own format and submits ISO). A dynamic, validation-rule-driven hint is tracked in [#251](https://github.com/zitadel/nextgen/issues/251).

## 0.1.0-alpha.11

### Minor Changes

- [#309](https://github.com/zitadel/nextgen/pull/309) [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102) Thanks [@bastionstack](https://github.com/bastionstack)! - Load the design-system brand font (Arimo) by default in `<zitadel-login>` so the
  auth UI paints the brand face even when the server returns no branding; headings
  render in bold Arimo. Tenant `branding.font_url` still overrides it. Exposes
  `applyDefaultFont` and `DEFAULT_BRAND_FONT_HREF` so deployments can self-host the
  default face.

## 0.1.0-alpha.10

### Patch Changes

- [#328](https://github.com/zitadel/nextgen/pull/328) [`acb5b54`](https://github.com/zitadel/nextgen/commit/acb5b549386efcc5ede005871b145c1cd0f9ac5e) Thanks [@fforootd](https://github.com/fforootd)! - Improve fresh-app CLI recovery guidance and align agent automation hook docs with the rendered login controls.

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- [#270](https://github.com/zitadel/nextgen/pull/270) [`30b4b41`](https://github.com/zitadel/nextgen/commit/30b4b411a9c99fc61d991f739636f93d7bee5b1d) Thanks [@vitorbari](https://github.com/vitorbari)! - Step `fields` and `actions` are now ordered `[{ name, ... }]` arrays on the wire (ADR 021). Templates iterate them in authorial order; the orchestrator builds `fields_by_name` / `actions_by_name` views for keyed lookups. The private `@zitadel/api-mock` workspace follows the same wire shape for tests. `gates` stays a name-keyed object for now.

## 0.1.0-alpha.5

### Patch Changes

- [#299](https://github.com/zitadel/nextgen/pull/299) [`f77ca44`](https://github.com/zitadel/nextgen/commit/f77ca44e85565976d26de0b6444b7fc5b1616e8c) Thanks [@fforootd](https://github.com/fforootd)! - Make the generated Next.js auth app easier for agents and developers to prove end-to-end registration, logout, and login in a visible browser.

- [#286](https://github.com/zitadel/nextgen/pull/286) [`3795b67`](https://github.com/zitadel/nextgen/commit/3795b6793c72b92300fc6a7d21c7562f0a25343e) Thanks [@bastionstack](https://github.com/bastionstack)! - Align the login flow with the latest Figma designs: load `branding.font_url` at document level so branded fonts (including the heading face) actually render, change the sign-in CTA from "Continue" to "Sign in", add the missing `identifier.field.password` label, drop the sign-up subheadline, and rename the passkey registration action to "Continue with a passkey". The default login flow no longer shows the post-registration passkey upsell screen — passkey registration is offered up front instead.

## 0.1.0-alpha.4

### Patch Changes

- [#279](https://github.com/zitadel/nextgen/pull/279) [`ce237ef`](https://github.com/zitadel/nextgen/commit/ce237ef355422c666769eef20df78bdc8ec0e0f9) Thanks [@fforootd](https://github.com/fforootd)! - Harden local setup guidance, Next 16 scaffolding, and login form automation.

## 0.1.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- [#266](https://github.com/zitadel/nextgen/pull/266) [`01aed1e`](https://github.com/zitadel/nextgen/commit/01aed1e0de4ffd1ec6d78f8fa73f0ce19b907aa0) Thanks [@mridang](https://github.com/mridang)! - Allow configuring `<zitadel-login>` and `<zitadel-logout>` declaratively from HTML via `project-id`, `proxy-path`, and `url` attributes, so the components work on a plain page without JS or `configureZitadel()`. Configuration resolves in this order, highest first: the `project` property, then the `configureZitadel()` global, then the HTML attributes. The existing JS paths still win — the attributes are the no-JS fallback.

  Also fix the standalone bundle so it loads in a browser: it was built for Node and emitted an `import "node:module"` that browsers cannot resolve. It is now built for the browser, so `dist/standalone.mjs` is genuinely self-contained.

- [#261](https://github.com/zitadel/nextgen/pull/261) [`09aa2b1`](https://github.com/zitadel/nextgen/commit/09aa2b13da9dd0e15453f46f4d62fb2863835a0c) Thanks [@mridang](https://github.com/mridang)! - Add a standalone browser bundle (`dist/standalone.mjs`) so the components work on a plain HTML page via `<script type="module">` with no import map or bundler. Exposed via the `./standalone` export and `unpkg`/`jsdelivr`.

### Patch Changes

- [#231](https://github.com/zitadel/nextgen/pull/231) [`ce89c59`](https://github.com/zitadel/nextgen/commit/ce89c5941b4ae90849fac720ecc4a2a0c49c245d) Thanks [@bastionstack](https://github.com/bastionstack)! - Tidy the web components package: align README/AGENTS docs with the real SDK-config API, adopt idiomatic Lit patterns (`classMap`, `live()`, `ifDefined`, `@query`, a shared `emit()` helper), make post-step focus deterministic via `updateComplete` instead of `requestAnimationFrame`, centralise SDK/API resolution in a `resolveApi()` helper, correct the manifest registry (e.g. `zl-passkey` `method` attribute), and expand unit/browser test coverage.

- [#253](https://github.com/zitadel/nextgen/pull/253) [`c097a5f`](https://github.com/zitadel/nextgen/commit/c097a5f0b720e58920c692ec909960e9c44696e3) Thanks [@vitorbari](https://github.com/vitorbari)! - Add English labels for the `givenName`, `familyName`, and `dateOfBirth`
  fields the default register step now collects.

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
