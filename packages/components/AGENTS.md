# Components Agent Notes

Scoped instructions for `packages/components/`. Read together with the
[root `AGENTS.md`](../../AGENTS.md).

## What's in here

Lit-based atoms (`<zl-*>`) and the `<zitadel-login>` orchestrator for the
auth flow API. Consumed directly by tenant pages and indirectly by the
`apps/console` shell. See [`README.md`](README.md) for consumer-facing
docs.

The orchestrator calls `@zitadel/api` (orval-generated typed fetch
client) through the wrappers in `src/orchestrator/api-client.ts`. There is
no transport abstraction, no wire-vs-internal type split, and no shadow
types — the orchestrator stores the orval `CreateFlow201` shape directly
and the Liquid renderer reads it through the `LiquidContext` projection.

Tests intercept at the network layer with MSW. The dev playground and the
unit tests both source their handlers from `@zitadel/api-mock`
(`setupMock(worker)` for the browser, `setupMockHandlers()` for
`msw/node`). Configure the API base URL with `setApiBaseUrl()` from
`@zitadel/api/runtime/base-url`, or via the `api-base` attribute
on `<zitadel-login>` for declarative setups.

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

Atom styles must consume design tokens through the `cssVar(...)` helper
(`src/tokens/css-var.ts`). New tokens go in `src/tokens/catalogue.ts`. The
orchestrator maps `branding` tokens to CSS variables on its own shadow root —
do not reach for inline styles in atoms.

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

When a test needs the Flow API, prefer `setupMockHandlers()` from
`@zitadel/api-mock` over hand-rolled handlers — it walks the same
xstate machine the dev playground uses, so step fixtures and step routing
stay consistent.

The full sign-in handover (terminal step → session exchange → real
`Set-Cookie` on the demo origin → full-page navigation to a protected
route) is covered end-to-end in `apps/demo-next-e2e/` and
`apps/demo-nuxt-e2e/`, not here. The exchange URL is controlled by
`session-exchange-path` on `<zitadel-login>`: the default
`/sessions/exchange` is prefixed with `api-base`; any other path is
resolved from `location.origin` so SPAs can rewrite exchange separately
from the flow API. Unit coverage lives in `api-client.spec.ts` and
`zitadel-login.spec.ts`. When a change touches `maybeCompleteFlow`,
`sessionExchangePath`, or the `postSignInUrl` path, run **both** e2e projects — they exercise
different SDK middlewares against the same orchestrator code, which is
how a regression in one framework slips past the other.

When iterating against a long-running demo dev server, remember the demo
loads this package's built `dist/` (not source). The Nx `e2e` target has
`dependsOn: ["^build"]` so CI is safe; manual loops need a fresh
`nx build @zitadel/components` after orchestrator changes.

### Lit dev playground (`:5173`) and caching

Atom `.ts` hot reload uses [`vite-plugin-web-components-hmr`](https://github.com/fi3ework/vite-plugin-web-components-hmr)
(Open WC–derived Lit preset) on `src/**/*.ts` only. `dev/pages/*.ts` is plain
`innerHTML` — `dev/main.ts` accepts those modules and calls `mountRoute()` again;
`dev/playground-chrome.css` and sibling-package CSS trigger a full reload via
`vite/lit-dev-hmr.ts` (`workspaceStylesFullReload`).

If the playground still looks stale after save:

```sh
corepack pnpm --filter @zitadel/components dev:clean
```

Then hard-refresh the browser. `apps/console` (`:5174`) does not pick up Lit-only
source edits — use `:5173` for atom work.

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
