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
and the accessibility tree, not ARIA widgets hand-rolled in shadow DOM.

- The operable control is native: `<zl-field>` an `<input>`, `<zl-checkbox>`
  an `<input type="checkbox">`, `<zl-select>` a `<select>` with real
  `<option>`s.
- It carries `data-testid="zitadel-<kind>-<name>"`, re-dispatches a composed
  `change` (and `input`) across the shadow boundary, and keeps
  `setFormValue()` in sync on every change. The re-dispatched `input` carries
  its `data` only for a field `isDisclosable` (`src/internal/secret-field.ts`)
  allows; for any other field it is `null`.
- Hide it with `opacity: 0` and `pointer-events: none`, never `display: none`,
  `visibility: hidden` or `aria-hidden`.
- Styling it cannot take (a custom popup) is a pointer-only layer:
  `aria-hidden`, out of the tab order, its state in `data-*` hooks.
  `<zl-select>` is the reference.

## Secrets and events

Nothing a page script can reach from the host element may hold or return a
secret. Three rules keep that true:

- Events that cross the shadow boundary never carry secret values. An event that
  carries a field value or a credential and is only for the widget itself
  (`zl-input`, `zl-change`, `zl-passkey-result`) is emitted `{ composed: false }`,
  so no page script sees it, capture phase included. A public event carries a
  value only for a field `isDisclosable` allows.
- A host's state that holds a typed value or a token (`response` with the flow's
  session token, `formValues`) is an ES-private (`#`) field, and so is every
  helper that returns atoms or values (`#fieldAtoms`, `#collectSubmitFields`).
  TypeScript's `private` is gone at runtime, and the host is what `querySelector`
  and every event's retargeted `event.target` hand to a script. Lit's decorators
  cannot declare a `#` field, so its setter calls `requestUpdate` itself.
- `<zitadel-session>` and `<zitadel-logout>` hold no credential: their state is
  the signed-in identity the widget shows and a project handle, and the session
  is a cookie the script cannot read.

The "what the page can observe" tests in
`src/orchestrator/zitadel-login.browser.spec.ts` enforce this across a whole
sign-in with real typing: they capture every event the widget can emit in both
phases, scan everything reachable from the host and from each event's target for
the typed values and session tokens, and check the host exposes no member named
for values, atoms or the flow. Extend them when you add an event, a kind of
field, or state on a widget.

What this does not cover is anything the browser or an open shadow root gives a
script: an atom's `value`, `formValue` and `<input>` through an open `shadowRoot`
or an event's `composedPath()`; the browser's own keyboard, `beforeinput`,
`textInput` and `input` events (nulling `data` on the `input` a field re-publishes
is defence in depth, it gives nothing against a script listening to those); and
`getSelection().toString()`, which reads a non-password text field (a PIN, a card
number) after a user, or `execCommand("selectAll")`, selects its text. Closing
the shadow roots in production narrows the first of these and is tracked
separately.

## Tests

- `pnpm test` runs both projects of `vitest.config.ts`: `unit` (jsdom) and
  `browser` (Chromium, `*.browser.spec.ts`). `pnpm test:unit` is the fast lane;
  `pnpm test:browser` runs the browser project alone.
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
