# @zitadel/components

## 0.1.0-alpha.17

### Patch Changes

- [#544](https://github.com/zitadel/nextgen/pull/544) [`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999) Thanks [@fforootd](https://github.com/fforootd)! - Fixes from alpha.16 community feedback:
  - Custom schema fields now render a readable label. A property with no
    catalog entry (e.g. `department`, `dateOfBirth`) falls back to a
    humanised name ("Department", "Date of birth") on the form instead of
    leaking the raw `<step>.field.<name>` text key. A catalogued key still
    wins, so localised labels are unaffected.
  - The scaffolded `.zitadel/flows/README.md` no longer contains the
    "Presets" section twice.
  - The `warn/default-flow-swap` plan warning now leads with the impact in
    plain language: the new flow becomes the default for its purposes, and
    every page that does not explicitly set `flow-name` on
    `<zitadel-login>` will start rendering it — scope it via `audience`
    or pin `flow-name` to opt out.
  - The flip-table validation error (login/register entry step missing its
    `user_not_found`/`user_already_exists` transition) now explains who
    gets stuck where: someone without an account would be stuck at
    sign-in instead of being routed to registration, and vice versa. Plan,
    apply, and the server report the same wording.

- [#525](https://github.com/zitadel/nextgen/pull/525) [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65) Thanks [@fforootd](https://github.com/fforootd)! - Every engine-emitted step error is now a localizable `error.*` catalog
  key — no `auth_attempt.*` literals leak into the login UI anymore.
  Rejected passkey proofs emit `error.passkey_invalid` (assertion) and
  `error.passkey_registration_invalid` (attestation), translated in every
  builtin locale; rejected password submissions emit the existing
  `error.invalid_credentials`, which the login component routes inline to
  the password field. The `step.error` contract docs now describe the
  `error.*` catalog plus verbatim outcome tokens (e.g. `user_not_found`)
  instead of citing `auth_attempt.*` diagnostics.

- [#543](https://github.com/zitadel/nextgen/pull/543) [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b) Thanks [@fforootd](https://github.com/fforootd)! - Automation hooks for auth-method credential fields are now method-named,
  matching what the docs have always promised: a flow field named
  `x-auth-methods#password` renders `data-testid="zitadel-field-password"`
  and `zitadel-input-password` instead of leaking the raw field name into
  the hooks. The `name` attribute (the wire/form key) is unchanged.
  Scripts that targeted the raw `zitadel-field-x-auth-methods#password`
  form must switch to the documented method-named hooks.

## 0.1.0-alpha.16

### Patch Changes

- [#495](https://github.com/zitadel/nextgen/pull/495) [`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852) Thanks [@fforootd](https://github.com/fforootd)! - Fix the duplicate "Continue with passkey" button: flow responses no longer embed a stale copy of the default login template. The login widget renders the up-to-date template bundled with `@zitadel/components`, which also brings checkbox/select field rendering and the empty-subtitle guard to real flows. A tenant-provided `branding.liquid_template` still takes precedence.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - Flow field validation errors now travel as localisation keys instead of
  developer strings: `step.error` carries `error.<field>_<rule>` per violation
  ("; "-joined, format spelled `_invalid` to match the catalog), and the login
  components localise them — catalog-known keys render inline on their field,
  unknown fields resolve through new generic `error.field_<rule>` fallbacks
  interpolated with the step's field label (en/de/it). A key routed inline whose
  field is not on the step downgrades to a visible banner message instead of
  disappearing. Users see "Please enter a valid email" instead of
  "flow field email: format".

- [#514](https://github.com/zitadel/nextgen/pull/514) [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2) Thanks [@fforootd](https://github.com/fforootd)! - Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
  attribute (`flowName` prop on every framework wrapper) that sends
  `flow_definition_name` on flow start, so a project with several synced
  flows can run a specific one instead of the audience-resolved default.
  An unknown name or a purpose mismatch surfaces as a clear startup error
  naming the attribute. Audience selection itself is now honored and
  deterministic: hinted app beats hinted team beats the newest unscoped
  flow, and a flow scoped to an app/team no longer captures the project
  default. The flows README and plan/apply docs explain how to add and
  select a second flow.

  Because newest-unscoped-wins means a new flow can silently take over the
  default login, `plan` warns on any create of an active, unscoped flow in
  a project that already has flows (`warn/default-flow-swap`, a
  non-blocking `# warning:` line and a `--json` warnings entry) — scope
  the flow via `audience` or pin `flow-name` in the widget to opt out.
  The offline dialect gains the committed `auth-methods`/`auth-method`
  meta-schema copies that `user-schema.json` references, so editors
  resolve the full dialect without network access.

- [#496](https://github.com/zitadel/nextgen/pull/496) [`754c7f6`](https://github.com/zitadel/nextgen/commit/754c7f6d8b970438a5ffa2c5c57ef72a2b5ed657) Thanks [@fforootd](https://github.com/fforootd)! - Custom flow steps no longer render a raw `<step>.action.back` key on the back
  button: the `| t` filter now falls back to a generic `action.back` entry
  (shipped in en/de/it) when a step-specific key is missing. Step-specific keys
  still win when defined.

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - The login form now shows a "Waiting for your passkey…" status with a Cancel
  button while a WebAuthn ceremony is in flight; cancelling aborts the ceremony
  and returns to the step with the fallback actions usable. Ceremony timeouts get
  their own copy (`error.passkey_timeout`) instead of reading as cancellations,
  and the cancelled copy no longer says "setup" for login ceremonies.
  `<zl-passkey>` emits a new `zl-passkey-started` event and accepts
  `pending-label`, `cancel-label`, and `silent` attributes. Step error banners
  are dismissible and clear as soon as the user edits a field (the edited
  field's inline error clears too); errors reappear only if the server
  re-reports them.

- [#500](https://github.com/zitadel/nextgen/pull/500) [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup` now asks "How should users sign in?" and scaffolds the
  matching schema+flow preset: `password-first` (today's default) or
  `passkey-first` (a one-tap passkey on the login entry step with an
  email → password fallback path, passkey-primary registration, and email
  kept required so the fallback always works). Non-interactive and scripted
  runs use `--preset`; the choice is recorded in `zitadel.json`. Presets are
  named bundles under `@zitadel/config` (the mechanism behind app-type
  selection, [#448](https://github.com/zitadel/nextgen/issues/448)) and are hygiene-tested: every bundle must pass the flow
  validator and resolve every text key in every builtin locale.

## 0.1.0-alpha.15

### Patch Changes

- [#486](https://github.com/zitadel/nextgen/pull/486) [`f45d47c`](https://github.com/zitadel/nextgen/commit/f45d47c5850edc83a55b5ad7364a59ffac4fd37c) Thanks [@fforootd](https://github.com/fforootd)! - Fix the default login template rendering two passkey buttons when the flow marks the passkey action as primary.

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

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
