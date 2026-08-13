# Components Agent Notes

Scoped instructions for `packages/components/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

Lit-based atoms (`<zl-*>`) and the orchestrators for the auth flow API:
`<zitadel-login>` (flow runner), `<zitadel-logout>`, and `<zitadel-session>`
(session surface), all under `src/orchestrator/`. Consumed directly by tenant
pages and indirectly by the `apps/console` shell. See [`README.md`](README.md)
for consumer-facing docs.

## Theming

Mode resolution is owned by `src/orchestrator/theme-controller.ts` +
`surface.ts`, which stamp `data-theme` / `data-theme-dark` on the host. The
precedence is strongest-first: the embedding page's `theme` property → stored
branding `theme.mode` → a variant-derived default (`dark` for
`variant="page"`, `auto` for `variant="widget"`) — see amended ADR 014 §5 and
`theme.browser.spec.ts`. Never hardcode mode-specific colors in orchestrator
CSS; consume the semantic tokens, which flip via `[data-theme="light"]`.

The orchestrator calls `@zitadel/api` (orval-generated typed fetch
client) through the wrappers in `src/orchestrator/api-client.ts`. There is
no transport abstraction, no wire-vs-internal type split, and no shadow
types — the orchestrator stores the orval `CreateFlow201` shape directly
and the Liquid renderer reads it through the `LiquidContext` projection.

Tests intercept at the network layer with MSW. The unit tests and the
Storybook orchestrator stories both source their handlers from
`@zitadel/api-mock` (`setupMockHandlers()` for `msw/node`; the same handlers
via `msw-storybook-addon` in [`apps/storybook`](../../apps/storybook/README.md)).
Configure the SDK with `configureZitadel({ projectId, proxyPath })`
from `@zitadel/api/config`; the element reads the global handle via
`getZitadelConfig()`, or you can assign the returned handle to the element's
`project` property. There is no `api-base` attribute.

## Type boundaries

There are exactly three places types live in this package:

- **Wire shapes** — never declared here; imported from
  `@zitadel/api/generated/model` (`CreateFlow201`,
  `CreateFlow201Step`, `CreateFlowBody`, `SubmitFlowStepBody`, …).
- **Branding** — `src/orchestrator/branding.ts` carries the client-side
  branding extensions (`Branding`, `BrandingPalette`, `BrandingShape`,
  `BrandingTheme`, `BrandingTypography`, `BrandingAssets`, `FlowLayout`).
  These are real client extensions of the OpenAPI Branding component
  (palette / typography / shape / theme tokenisation aren't on the wire).
- **Template context** — `src/orchestrator/template-context.ts` carries
  the projection tenant Liquid templates can reference (`FlowMessage`,
  `FlowIdentity`, `FlowError[]`, `LiquidContext`). Lifted from the wire
  by the orchestrator at render time.

Do not introduce new shadow types that mirror orval. If the wire shape is
fine, use it directly.

## Source-level conventions

### Lit reactivity — always use `accessor`

All `@property` and `@state` declarations must use the `accessor` keyword:

```ts
@property() accessor name = "";
@state() private accessor hasHelp = false;
```

Plain class fields (`@property() name = "";`) shadow Lit's auto-generated
accessors when the build target is `es2022` or any toolchain that sets
`useDefineForClassFields: true` (Vite, tsdown, esbuild). Lit logs a console
error in dev mode and silently fails to detect changes in prod. The fix is
not "turn off the warning" — it is the `accessor` keyword.

### Atoms are form-associated by default

Every input atom (e.g. `<zl-field>`) must:

- declare `static formAssociated = true`,
- attach `ElementInternals` in the constructor,
- mirror its value via `internals.setFormValue()` and validity via
  `internals.setValidity()`,
- implement `formResetCallback` and `formStateRestoreCallback`,
- enable `delegatesFocus: true` on its shadow root.

This is what makes password managers, browser autofill, native form submission
and validation work through Shadow DOM. The decision is documented in
[`docs/design/branding/form-participation.md`](../../docs/design/branding/form-participation.md);
read that before touching `zl-field` or adding new input atoms.

`jsdom` only partially implements `ElementInternals`. Form-association tests
go in `*.browser.spec.ts` files (real Chromium); jsdom-friendly aria/markup
checks go in `*.spec.ts`.

### Input atoms expose a real native control (agent-first)

The Zitadel CLI is an agent-facing product: an agent must be able to fill the
generated auth UI and register a user. Automation drivers — Playwright
(`selectOption`, `fill`, `getByTestId`), the chrome-devtools accessibility
snapshot, the Codex in-app browser, password managers, and screen readers — all
operate through **real native form controls and the accessibility tree**, not
through hand-rolled ARIA widgets in Shadow DOM. A purely custom widget (a
`<div role="combobox">` + `<ul role="listbox">`, for example) is opaque to them:
its options never surface as targetable nodes.

So every input atom must make its operable, accessible, automatable control a
**real native element**:

- `<zl-field>` → native `<input>`.
- `<zl-checkbox>` → native `<input type="checkbox">`.
- `<zl-select>` → native `<select>` with real `<option>`s.

That native element must:

- carry a stable `data-testid` of the form `zitadel-<kind>-<name>` (e.g.
  `zitadel-input-email`, `zitadel-checkbox-newsletterOptIn`,
  `zitadel-select-maritalStatus`), so tests/agents target it by name;
- re-dispatch a composed native `change` (and `input` where applicable) across
  the shadow boundary, and keep `internals.setFormValue()` in sync on every
  change — so a value set directly on the native control (autofill, an agent,
  programmatic `selectOption`) is still captured before submit;
- stay in the accessibility tree and the tab order. Visually hide it with
  `opacity: 0` / `pointer-events: none` (see `<zl-checkbox>`, `<zl-select>`
  surface CSS) — **never** `display: none`, `visibility: hidden`, or
  `aria-hidden`, which would drop it from the a11y tree and the tab order.

When a design needs styling the native control can't provide (e.g. a custom
dropdown popup), keep the styled UI as a **pointer-only visual layer**: mark it
`aria-hidden` and out of the tab order so it doesn't duplicate the native
control for AT/agents, and route its state through `data-*` hooks rather than
ARIA. The native control remains the single source of truth; the visual layer
just mirrors `value` and feeds the same change path. `<zl-select>` is the
reference implementation. This convention was established in PR #279 (fields,
buttons) and extended to selects.

### No `CSS.escape` in runtime code

`jsdom` 29 does not ship `CSS.escape`. Code that runs in tests must not rely
on it — query the DOM directly (`querySelectorAll` + `getAttribute` filtering)
rather than building attribute selectors with `CSS.escape(value)`.

### Templates are sanitised

Output from the Liquid pipeline is run through DOMPurify with an allowlist
built from `manifestRegistry`. When you add a new attribute or part to an atom,
update its manifest in `manifests.ts` so the sanitiser keeps it. Anything not
in the allowlist is silently stripped.

### Tokens, not magic values

Atom styles must consume design tokens through the `t` helper
(`src/styles/tokens.ts`), which wraps the `@zitadel/design-tokens` `cssVars`
tree as Lit `CSSResult` values (e.g. `t.color.surface.defaultWhite`). Tokens
themselves are owned by the `@zitadel/design-tokens` package — add new ones
there, not here. The orchestrator maps `branding` tokens to CSS variables on
its own shadow root — do not reach for inline styles in atoms.

### Comments

Comments explain *why*, not *what*. Skip comments like
`// increment counter` or `// import the module`. Useful comments call out
trade-offs, browser quirks, or constraints the code itself can't convey.

## Tests

Two Vitest projects, one config (`vitest.config.ts`):

- `unit` — `jsdom`. Default; what `pnpm test` runs.
- `browser` — Chromium via `@vitest/browser-playwright`. Run with
  `pnpm test:browser`. Tests in `*.browser.spec.ts` only.

Always cover form-associated behaviour, focus delegation, and Enter-to-submit
in the browser project. Anything markup-only (aria attributes, classes, slot
projection) belongs in the unit project for speed.

### The `browser` project "hangs" — it doesn't, it's cold-start

The browser project launches real headless Chromium via Playwright **and**
resolves the whole workspace from source (`resolve.conditions:
["@zitadel/source"]`). On a cold run Vite pre-bundles a large graph (`lit`, the
generated `@zitadel/api` client, `dompurify`, `liquidjs`) **before the first
test**: that warm-up is 60–120s+ and variable, while the tests themselves run in
~1s. With a warm `node_modules/.vite` cache the same run finishes in seconds. It
is intentionally `runInCI: false` in `moon.yml` — a heavy, opt-in local check,
not part of the default loop (`moon ci :lint :typecheck :build :test` runs only
the jsdom `unit` project).

What actually makes it look stuck, and how to avoid it:

- **Don't pipe through `tail`** (or any buffering filter). It withholds all
  output until EOF, so the entire warm-up looks frozen. Let it stream.
- **Don't kill a run mid-flight and immediately retry.** An interrupted run
  leaves a zombie Chromium + Vite dev server holding the port; the next run logs
  `Port 63315 is in use, trying another one...` and stalls retrying. If you did
  interrupt one, clear it first:

  ```sh
  pkill -f vitest; pkill -f chrome-headless-shell
  ```

- **Run it directly and patiently**, expecting a slow first run then fast reruns:

  ```sh
  corepack pnpm --filter @zitadel/components test:browser   # or: moon run components:test-browser
  ```

- For a single file: `corepack pnpm --filter @zitadel/components exec vitest run --project browser <name>`.

`vitest run` exits non-zero on any failure, so a `0` exit is authoritative even
when the non-TTY summary line doesn't flush to a redirected log.

When a test needs the Flow API, prefer `setupMockHandlers()` from
`@zitadel/api-mock` over hand-rolled handlers — it walks the same
xstate machine the Storybook orchestrator stories use, so step fixtures and
step routing stay consistent.

The full sign-in handover (terminal step → session exchange → real
`Set-Cookie` on the demo origin → full-page navigation to a protected
route) is covered end-to-end in `apps/demo-next-e2e/` and
`apps/demo-nuxt-e2e/`, not here. The terminal `handoff_token` is exchanged
through the generated `exchangeSession` wrapper in `api-client.ts` (which
hits the SDK proxy path); there is no `session-exchange-path` attribute. Unit
coverage lives in `api-client.spec.ts` and `zitadel-login.spec.ts`. When a
change touches `maybeCompleteFlow` or the `postSignInUrl` path, run **both**
e2e projects — they exercise different SDK middlewares against the same
orchestrator code, which is how a regression in one framework slips past the
other.

When iterating against a long-running demo dev server, remember the demo
loads this package's built `dist/` (not source). The Moon e2e tasks depend on
the relevant build tasks so CI is safe; manual loops need a fresh
`moon run components:build` after orchestrator changes.

### Workbench

The interactive workbench is [`apps/storybook`](../../apps/storybook/README.md)
(`moon run storybook:dev`, `:6006`): the Lit atoms, the paired React
components, and the `<zitadel-login>` orchestrator (MSW via
`msw-storybook-addon`). It loads the built `dist/`, so rebuild after source
changes (`moon run components:build`) — the Storybook tasks depend on it.

## Build

`tsdown.config.ts` produces ESM + `.d.mts` and externalises `lit`, `liquidjs`,
`dompurify`, and the `@zitadel/api*` packages so npm consumers dedupe
with their own copies. Do not bundle those in by default — that breaks shared
instances and bloats the package.

## Don't

- Don't bypass Lit's render with manual `innerHTML` mutation. Use `unsafeHTML`
  inside a `render()` (the orchestrator already does this for Liquid output;
  atoms should never need it).
- Don't add a `template` accessor on `<zitadel-login>` casually — it changes
  the public surface. There is an open follow-up to do this properly with
  per-tenant template caching; coordinate before implementing.
- Don't ship a new atom without a manifest entry, a unit spec, a browser spec
  if it owns user input, and an entry in the orchestrator's sanitiser
  allowlist (which reads from `manifestRegistry` automatically — but verify
  with a spec).
- Don't re-introduce a `FlowResponse` / `FlowStep` / `FlowField` alias that
  duplicates orval. If the wire isn't usable directly, fix that in
  `packages/api/orval.config.ts` so the typed client improves for everyone.
