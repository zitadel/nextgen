# Agent Instructions — `packages/components`

The Lit atoms (`<zl-*>`) and the orchestrators under `src/orchestrator/`
(`<zitadel-login>`, `<zitadel-logout>`, `<zitadel-session>`). Consumer docs:
[`README.md`](README.md). To add an atom, follow the recipe in
[`apps/storybook/AGENTS.md`](../../apps/storybook/AGENTS.md).

## Theming and types

- The theme mode is resolved in `src/orchestrator/theme-controller.ts` and
  `surface.ts`, strongest first: the page's `theme` property, the branding's
  `theme.mode`, the variant's default (amended ADR 014 §5). Orchestrator CSS
  uses the semantic tokens, never a mode-specific colour.
- Wire shapes come from `@zitadel/api/generated/model`, and the orchestrator
  stores them as they are. Never add a shadow type that mirrors orval
  (`FlowResponse`, `FlowStep`, …); if the wire shape is unusable, fix
  `packages/api/orval.config.ts`.
- `src/orchestrator/branding.ts` aliases the generated branding model;
  `attribution` is its one client extension. A new appearance key goes into
  `api/openapi/` first.
- The orchestrator calls the API through `src/orchestrator/api-client.ts`,
  configured with `configureZitadel(...)` from `@zitadel/api/config`. There is
  no `api-base` attribute.

## Source conventions

- Declare every `@property` and `@state` with `accessor`
  (`@property() accessor name = "";`). A plain field shadows Lit's accessor
  under `useDefineForClassFields` (Vite, tsdown, esbuild), and changes are
  silently missed.
- The orchestrator elements take `property` from `src/internal/property.ts`,
  not `lit/decorators.js`: assigning `undefined` or `null` restores the
  default, so framework wrappers can pass unset props through.
- An atom that holds a value extends `FormAtom` (`src/internal/form-atom.ts`),
  which owns `ElementInternals`, focus delegation, reset, restore and
  `<fieldset disabled>`. Never hand-roll form association; the decision is in
  [`form-participation.md`](../../docs/design/branding/form-participation.md).
- Pass `toggleAttribute` and `classList.toggle` a real boolean, never a bare
  property: `undefined` toggles on every render, and wrappers assign
  `undefined` for unset props where TypeScript cannot see it.
- Never call `CSS.escape` in runtime code: jsdom does not ship it.
- Atom CSS references `var(--zl-*)`; a Lit `css` template uses the `t` helper
  (`src/styles/tokens.ts`). New tokens belong in `@zitadel/design-tokens`.
- A new attribute or part on an atom goes into its manifest
  (`src/manifests.ts`): the sanitiser's allowlist and `exportparts` derive
  from `manifestRegistry`, so an unlisted part is unreachable.
- Never mutate `innerHTML`; only the orchestrator renders Liquid output, with
  `unsafeHTML` inside `render()`.
- Coordinate before adding a `template` accessor to `<zitadel-login>`: it
  changes the public surface.
- Comments explain why, not what.

### Input atoms expose a real native control

Agents, Playwright, password managers and screen readers drive native controls
and the accessibility tree, not ARIA widgets hand-rolled in shadow DOM. The
roots they sit in are closed in a shipped build and open under test
([Shadow roots](#shadow-roots)).

- The operable control is native: `<zl-field>` an `<input>`, `<zl-checkbox>`
  an `<input type="checkbox">`, `<zl-select>` a `<select>` with real
  `<option>`s.
- It carries `data-testid="zitadel-<kind>-<name>"`, re-dispatches a composed
  `change` (and `input`) across the shadow boundary, and keeps
  `setFormValue()` in sync on every change.
- Hide it with `opacity: 0` and `pointer-events: none`, never `display: none`,
  `visibility: hidden` or `aria-hidden`.
- Styling it cannot take (a custom popup) is a pointer-only layer:
  `aria-hidden`, out of the tab order, its state in `data-*` hooks.
  `<zl-select>` is the reference.

## Tests

- `pnpm test` runs the three projects of `vitest.config.ts`: `unit` (jsdom),
  `browser` (Chromium, `*.browser.spec.ts`) and `closed-roots` (Chromium with
  the shipped closed roots, `*.closed.browser.spec.ts`). `pnpm test:unit` is
  the fast lane; `pnpm test:browser` runs the two Chromium projects.
- Put a test in the lowest project that proves it (the ladder in
  [`packages/testing/AGENTS.md`](../testing/AGENTS.md#which-layer-a-test-belongs-in)):
  form association and focus in `browser`, markup and ARIA in `unit`.
- A new atom ships with a manifest entry, a unit spec, a browser spec if it
  takes input, and a spec that the sanitiser keeps it.
- Mock the Flow API with `setupMockHandlers()` from `@zitadel/api-mock`, never
  hand-rolled handlers.
- The sign-in handover (exchange, `Set-Cookie`, navigation) is covered by the
  demo e2e lanes. After touching `maybeCompleteFlow` or `postSignInUrl`, run
  both: each exercises a different SDK middleware.
- The demos load this package's `dist/`: in a manual loop, run
  `moon run components:build` after an orchestrator change.

### The browser project's cold start

A cold run pre-bundles a large graph for 60–120 s or more before the first
test; a warm `.vitest` cache brings that down to seconds.

- Let it stream: a buffering filter such as `tail` makes it look frozen.
- Never kill a run and retry at once: a stray Chromium and Vite server keep
  the port (`Port … is in use`). Clear them first:
  `pkill -f vitest; pkill -f chrome-headless-shell`.
- One file: `corepack pnpm --filter @zitadel/components exec vitest run --project browser <name>`.
- A `0` exit is authoritative even when the summary line does not flush.

## Build

`tsdown.config.ts` keeps `lit`, `liquidjs`, `dompurify` and `lucide` external
in the library build so consumers share one copy; never bundle them there.

## Shadow roots

Every shipped element's root is closed, so `host.shadowRoot` is `null` for a
page script. Source builds (Vitest, Storybook) keep it open; an app's dev
server resolves `dist`, so it gets closed roots too.

- The mode is decided once, by `SHADOW_ROOT_MODE` in
  `src/internal/shadow-root.ts`; `shadow-root-define.ts` closes it for both
  shipped artifacts and the `closed-roots` test project. Never write a mode or
  a second flag anywhere else.
- Every element that renders into a shadow root extends `ZlElement` from that
  file; `shadow-root.spec.ts` checks every element the package defines.
- Reach your own root with `this.ownRoot`, never `this.shadowRoot` (`null`
  when closed).
- Never tell where an event came from with `composedPath()[0]`: a closed root
  hides the inner nodes, so every inner event looks like the host's own. Mark
  the events your own listeners handled instead (`zl-button`, `zl-select`).
- Secrets never cross the shadow boundary: no secret value in an event that
  leaves a root, in a host property or in an attribute.
- Playwright pierces open roots only. Use `test` or `widgetTest` from
  `@zitadel/testing/playwright`, which open them; never patch `attachShadow`
  in a suite.
- A closed root is a guard against casual reads, not a boundary: Lit's own
  properties on the element still lead to the root. Say so wherever you
  document it, and name a cross-origin iframe as the only real isolation.
