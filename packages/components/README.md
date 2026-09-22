# @zitadel/components

Lit-based atomic web components and the `<zitadel-login>` orchestrator for the
Zitadel auth UI.

The package exports:

- **Atoms** — `<zl-field>`, `<zl-button>`, `<zl-alert>`, `<zl-icon>`,
  `<zl-pill>`, `<zl-card>`, `<zl-checkbox>`, `<zl-select>`,
  `<zl-page-shell>`, and `<zl-passkey>` (an invisible WebAuthn ceremony
  handler — no rendered surface). Form-associated, accessible,
  branding-aware Lit elements that map 1:1 to the flow API
  field/action/error primitives and the Figma design system.
- **Orchestrators** — `<zitadel-login>`, a single drop-in element that calls
  the flow API, renders each step through a Liquid template, manages focus
  and form submission, and applies branding/theme/locale; `<zitadel-logout>`
  for sign-out; and `<zitadel-session>`, the post-sign-in "signed in" card
  (session read + sign-out in one element).
- **Tokens & manifests** — design tokens (`--zl-*` CSS custom properties), a
  Liquid template registry, and per-atom manifests describing allowed
  attributes/parts/events for sanitiser allowlists.

It is consumed directly by tenants embedding the auth UI on their own pages
and indirectly by the `apps/console` shell.

## Status

Pre-release substrate. APIs are stabilising alongside
[`docs/design/branding/`](../../docs/design/branding/) and
[`docs/design/flowengine/`](../../docs/design/flowengine/). Expect minor breaks
until the first published version. See
[`docs/design/branding/form-participation.md`](../../docs/design/branding/form-participation.md)
for the form-association / accessibility decisions baked into every input atom.

## Install

```sh
corepack pnpm add @zitadel/components
```

`lit`, `liquidjs`, and `dompurify` are peer/runtime deps and are intentionally
externalised so npm consumers dedupe with their own copies.

## Quickstart — drop on a page

The 90% case: configure the SDK once, render the element, optionally set a
language. `<zitadel-login>` reads the global project handle from
`configureZitadel()` via `getZitadelConfig()` — no per-element wiring needed.

```html
<script type="module">
  import '@zitadel/components';
  import { configureZitadel } from '@zitadel/api/config';

  // Write-once: sets the global project handle (and the proxy path the
  // generated client uses). The element picks this up automatically.
  configureZitadel({ projectId: 'proj_123', proxyPath: '/__nextgen' });

  const el = document.getElementById('login');
  el.lang = 'en'; // optional; defaults to <html lang> / navigator.language
</script>

<!-- variant="page" = a dedicated login route that owns the viewport.
     Omit it to embed a content-sized widget inside your own layout. -->
<zitadel-login id="login" variant="page" purpose="login"></zitadel-login>
```

What `<zitadel-login>` handles for you:

- `POST /flow` on mount, `POST /flow/{id}/submit` for every step, terminal
  `redirect` / `show` honoured automatically.
- Native `<form>` semantics: Enter submits, password managers see the inputs,
  `<button type="submit">` works, browser autofill works.
- Focus moved to the first field on every step change (and on load in
  `variant="page"`; an embedded widget deliberately leaves initial focus alone
  so it can't scroll-jump the page it sits on).
- Branding tokens mapped to CSS variables on the shadow root.
- Light and dark theme, hot-swappable: the `theme` property, else the tenant's
  `branding.theme.mode`, else the variant default (`page` dark, `widget`
  follows `prefers-color-scheme`).
- Mandatory gates (terms, captcha) enforced before submit.
- Output sanitised with DOMPurify against a per-atom allowlist before injection.
- Stateless server: the `_zflow` HttpOnly cookie is the source of truth
  between requests; every call runs with `credentials: "include"`.

### React / Astro / Next

Same element, lifted into JSX. Pass objects through `ref` rather than as
attributes (web component properties are typed objects, not stringified
attributes). Either configure the SDK globally with `configureZitadel()` and
let the element read it, or assign the returned handle to `el.project`.

```tsx
import '@zitadel/components';
import { configureZitadel } from '@zitadel/api/config';

const project = configureZitadel({
  projectId: 'proj_123',
  proxyPath: import.meta.env.VITE_ZITADEL_PROXY_PATH,
});

export function Login({ locales }: Props) {
  return (
    <zitadel-login
      purpose="login"
      ref={(el) => {
        if (!el) return;
        el.project = project;
        el.locales = locales;
      }}
    />
  );
}
```

### Mocking for offline demos and tests

The orchestrator calls the typed `@zitadel/api` fetch client
directly — there is no transport abstraction to swap. Intercept at the
network layer via the workspace-internal `@zitadel/api-mock`
package, which walks an xstate flow machine through identifier →
password → done (with register and SSO branches) using orval-typed step
fixtures:

- **Tests (`msw/node`)** — pass `setupMockHandlers()` from
  `@zitadel/api-mock` into `setupServer(...)`.
  `getCapturedRequests()` exposes captured request bodies for assertions.
- **Browser (`msw/browser`)** — `setupMock(worker)` wires the handlers into a
  `msw/browser` worker. The Storybook orchestrator stories take the equivalent
  path through `msw-storybook-addon` (see
  [`apps/storybook/src/orchestrator.stories.ts`](../../apps/storybook/src/orchestrator.stories.ts)).
  `applyBranding(...)` injects a tenant branding overlay merged into every
  response (presets include `font_url` for Inter).
- **Framework demos (TCP server)** — `moon run api-mock:start`
  serves the same handlers on port 8080 (set `PORT` to override) with
  `defaultDevBranding` (Arimo `font_url`) applied at boot. See
  [`apps/demo-next`](../../apps/demo-next/README.md)
  and [`apps/demo-nuxt`](../../apps/demo-nuxt/README.md).

### Preview surfaces

| Surface | Moon command | What it gives you |
| --- | --- | --- |
| **Storybook** | `moon run storybook:dev` ([:6006](http://localhost:6006)) | The workbench for the Lit atoms and the `<zitadel-login>` orchestrator (MSW via `msw-storybook-addon`, flow/branding as controls). |
| **demo-next** | `moon run api-mock:start` + `moon run demo-next:dev` | Next.js SDK, middleware, cookies, built `dist/` ([:3002/login](http://localhost:3002/login)). See [`apps/demo-next`](../../apps/demo-next/README.md). |
| **demo-nuxt** | mock on `:8080`, then `moon run demo-nuxt:dev` | Nuxt SDK, middleware, cookies, built `dist/` ([:3001/login](http://localhost:3001/login)). See [`apps/demo-nuxt`](../../apps/demo-nuxt/README.md). |

Storybook consumes the built `@zitadel/components` artifact, so rebuild
after source changes (`moon run components:build`) or
keep the Storybook dev server running — its tasks depend on the relevant
build tasks.

### Atoms-only (bypass the orchestrator)

If you want a fully bespoke shell, use the atoms directly. You give up the
template, transitions, and focus management; you keep the styled, accessible,
form-associated inputs.

```html
<form id="login">
  <zl-field name="email" label="Email" type="email" autocomplete="username" required></zl-field>
  <zl-button hierarchy="primary" type="submit" action="submit" label="Continue" block></zl-button>
</form>
```

## Customisation tiers

| Tier | Surface | Use when |
| --- | --- | --- |
| SDK config | `configureZitadel({ projectId, proxyPath })` from `@zitadel/api/config` | every consumer — sets the project + proxy path the element reads |
| Tokens (server) | branding payload returned from the server | tenant colour / logo / font, managed centrally |
| Tokens (host page) | `zitadel-login { --zl-color-…: … }` in your own stylesheet | matching the widget to the app you embedded it in |
| Layout / placement | host CSS on `zitadel-login { ... }`, `variant`, `--zl-page-min-height` | sizing and positioning inside your layout |
| CSS hooks | `zitadel-login::part(form)`, `zitadel-login::part(field-input)` | targeted overrides of atom internals |
| Locale | `el.lang = 'de'` / `el.locales = { ... }` | i18n / custom copy |
| MSW mocks | `setupWorker` / `setupServer` from `msw` | offline / staging / fixtures |
| Custom template | `zitadel branding eject` → edit Liquid → `zitadel apply`, or `branding.liquid_template` on the payload | tenant-supplied layouts |
| Atoms-only | hand-built form | non-standard flow shells |

For styling, start with the generated `--zl-*` variables from
`@zitadel/design-tokens`, then use host CSS on `zitadel-login { ... }` for page
placement and `::part(...)` hooks for targeted internals such as the form or
field input. The design-token package README is the canonical token catalogue;
the branding design notes explain the broader override ladder.

**Your stylesheet is the strongest styling authority.** A plain rule in the
embedding app wins:

```css
zitadel-login {
  --zl-color-text-primary-white: #101828;
  --zl-color-surface-default-primary-gray: #ffffff;
  --zl-radius-md: 0.25rem;
}
```

Those values reach the atoms' own shadow roots — custom properties inherit
across shadow boundaries — and they outrank both the design-system defaults
and the tenant's server-side branding, because the CSS cascade gives normal
declarations from the outer tree precedence over the `:host` rules the
orchestrator adopts internally. That ordering is deliberate: an app embedding
its own login should be able to match its design system without a server
round-trip. Leave the tokens alone and centrally-managed tenant branding
applies as before. `customization.browser.spec.ts` pins this.

**Sizing is a two-mode contract.** The default is `variant="widget"`:
content-sized, transparent through every layer, no fonts injected into your
document, no focus grab on load — drop it into a section, sidebar, or modal
and your app keeps owning the page. Dedicated login routes opt into the
full-page chrome:

```html
<zitadel-login variant="page"></zitadel-login>
<!-- claims the viewport, paints the surface background from tokens,
     loads the brand font, focuses the first field -->
```

Width-responsive chrome (the split designs' two-column collapse, the compact
brand header) keys off the **widget's own width** via container queries, so a
narrow embed on a desktop viewport lays out like a phone. Fine-grained height
control in either mode: `--zl-page-min-height` (inherits across the shadow
boundaries, releasing the orchestrator mount and the `zl-page-shell` atom in
one setting). `embedding.browser.spec.ts` pins this whole contract.

**Colour mode** ships light and dark. A `page` renders dark (the design
system's primary surface); a `widget` follows the visitor's
`prefers-color-scheme` so it doesn't force a dark card onto a light page.
Pin it when your app's surface is fixed:

```html
<zitadel-login theme="light"></zitadel-login>
```

Resolution runs strongest-first: this `theme` property → the tenant's
`branding.theme.mode` → the variant default. The resolved mode lands on
`data-theme` on the element, and every `--zl-*` token repaints with it.

Atom internals forward through the orchestrator as `<atom>-<part>` names —
`zitadel-login::part(field-input)`, `zitadel-login::part(button-root)` — for
every part an atom's manifest declares; bare names (`zl-field::part(input)`)
apply when composing atoms directly without the orchestrator
(`exportparts.browser.spec.ts` pins the forwarding).

Automation can use the stable host and native shadow-root hooks that the default
template emits. Host atoms expose hooks such as `zitadel-field-email`,
`zitadel-field-password`, and `zitadel-action-submit`; their native shadow
controls expose hooks such as `zitadel-input-email`, `zitadel-input-password`,
and `zitadel-action-submit-button`. Hooks are method-named even when the flow
engine names a credential field `x-auth-methods#<method>` — the `name`
attribute keeps that raw form key, only the `data-testid` hooks are normalised
(`hookName` in `src/internal/hook-name.ts`).

A tenant Liquid template can already be supplied through the branding
payload's `liquid_template` field; a dedicated declarative `template`
surface on `<zitadel-login>` is not yet exposed. The orchestrator otherwise
renders the bundled `default.liquid`. Tracked as a follow-up.

## Element APIs

### `<zitadel-login>`

| Property | Type | Notes |
| --- | --- | --- |
| `variant` | `'widget' \| 'page'` | Sizing/chrome mode. `widget` (default): content-sized, transparent, no font injection, no initial focus grab. `page`: full-page chrome for dedicated login routes |
| `theme` | `'light' \| 'dark' \| 'auto'` | Colour mode. Unset defers to `branding.theme.mode`, then to the variant default (`dark` for `page`, `auto` for `widget`). Resolved value lands on `data-theme` |
| `purpose` | `'login' \| 'register' \| 'reset_password' \| string` | Which flow purpose to drive |
| `flowName` / `flow-name` | `string` | Run the flow definition with this `name` instead of the project default |
| `project` | `ZitadelProject` | SDK handle from `configureZitadel()`. Object property (not an attribute). When unset, the element falls back to the global handle from `getZitadelConfig()` |
| `lang` | `string` | BCP 47 tag (e.g. `"de"`, `"en-US"`). Resolves to a built-in dictionary; falls back to `<html lang>` / `navigator.language` |
| `locales` | `Record<string, Locale>` | Custom locale dictionaries keyed by language code; spread over the built-in dictionary so partial overrides work |
| `postSignInUrl` / `post-sign-in-url` | `string` | After `complete: "show"`, exchange the `handoff_token` for a session cookie and navigate here |
| `resumeFlowId` / `resume-flow-id` | `string` | Resume an existing flow handle instead of starting fresh |

Events: `zitadel-flow-input`, `zitadel-flow-step`, `zitadel-flow-complete`,
`zitadel-flow-error`. `zitadel-flow-step` fires for every applied step
including the first, so a host app can drive its own chrome (progress,
headings, analytics) from mount onwards rather than from the first submit.
The orchestrator exposes `::part(form)` for tenant-side CSS hooks. Adopts
design tokens and `branding.font_url` into its shadow root on each update.

### `<zitadel-logout>`

Session menu / sign-out control for embedded apps. Reads the signed-in
identity from `getMySession` (`GET /sessions/me`) — the same source as
`<zitadel-session>` — calls `revokeMySession` (`DELETE /sessions/me`) through
the SDK handle, and clears the session. Uses the same token adoption as
`<zitadel-login>` (`applyBaseTokens`).

| Property | Type | Notes |
| --- | --- | --- |
| `project` | `ZitadelProject` | SDK handle from `configureZitadel()`. Object property; falls back to the global handle from `getZitadelConfig()` |
| `postSignOutUrl` / `post-sign-out-url` | `string` | Navigate here after sign-out |

Supports a light-DOM `<template>` slot for a fully custom menu; default UI is
the avatar trigger + dropdown.

### `<zl-field>`

Form-associated input. Participates in the parent `<form>`, supports validity
state, restores on form reset, and forwards Enter to `form.requestSubmit()`.

| Property | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Form key |
| `label` | `string` | Visible label (rendered above) |
| `type` | `'text' \| 'email' \| 'password' \| ...` | Native input type |
| `value` | `string` | Two-way bound; emits `zl-input` |
| `placeholder`, `autocomplete`, `pattern` | `string` | Forwarded |
| `required`, `disabled`, `invalid` | `boolean` | |
| `error` | `string` | Custom validity message |

Parts: `field`, `label`, `input`, `error`, `help`.

### `<zl-button>`

Single button atom covering the full Figma matrix:

| Attribute | Values | Notes |
| --- | --- | --- |
| `hierarchy` | `primary \| secondary \| text` | Visual rank |
| `size` | `medium \| small` | Figma surface sizes |
| `type` | `submit \| button` | When `submit`, takes part in the host `<form>` |
| `action` | `string` | Forwarded with the `zl-submit` CustomEvent |
| `loading`, `disabled`, `block` | `boolean` | |
| `label` | `string` | Convenience text; default slot is also supported |

Emits `zl-submit` for both primary submits and secondary navigations — the
orchestrator switches on `type`/`action` to decide whether to advance the flow
or just notify.

### `<zl-alert>`

Inline status message for the four Figma severities (`error \| success \|
warning \| info`). Renders the matching icon automatically; supports an
optional `heading` and default-slot body.

### `<zl-icon>` / `<zl-pill>` / `<zl-card>` / `<zl-page-shell>`

Pure presentational atoms — icons render from a curated inline-SVG sprite,
pills carry the "Secured with Zitadel" attribution chip (and any tenant
alternative), and `<zl-card>` + `<zl-page-shell>` build the auth-screen
chrome from design tokens.

See [`src/atoms/`](src/atoms) for full TypeScript types and JSDoc.

## Project layout

```
packages/components/
├── src/
│   ├── atoms/             zl-field, zl-button, zl-alert, zl-icon, zl-pill,
│   │                       zl-card, zl-checkbox, zl-select, zl-page-shell,
│   │                       zl-passkey + tests
│   ├── orchestrator/      <zitadel-login>, <zitadel-logout>, <zitadel-session>,
│   │                       api-client, liquid, branding
│   │   ├── locales/       bundled English fallback
│   │   └── templates/     default.liquid (all steps) + layout-chrome.css
│   ├── tokens/            re-export of @zitadel/design-tokens
│   ├── styles/            shared host styles, focus ring, t() css-var bridge
│   ├── manifests.ts       per-atom attribute / part / event manifests
│   └── index.ts           barrel
├── tsdown.config.ts       library build (externalises lit/liquidjs/dompurify)
└── vitest.config.ts       jsdom (unit) + chromium (browser) projects
```

The interactive workbench (the atoms and the `<zitadel-login>`
orchestrator) lives in [`apps/storybook`](../../apps/storybook/README.md).

## Develop

Use **Moon** for tasks in this monorepo (`moon run <project>:<task>`).
It matches CI caching and dependency order. Direct `pnpm --filter ...` scripts
still exist on some packages for leaf-package debugging, but Moon is the
documented path.

```sh
# install once at the repo root
corepack pnpm install

# --- Workbench ---

# Storybook: the atoms and the <zitadel-login> orchestrator
moon run storybook:dev
# → http://localhost:6006

# Framework demos (TCP mock + SDK) — see apps/demo-*/README.md
# moon run api-mock:start   # → http://localhost:8080
# moon run demo-next:dev    # → :3002 (ZITADEL_URL defaults to :8080)
# moon run demo-nuxt:dev    # → :3001 (ZITADEL_URL defaults to :8080)

# --- Package checks ---

moon run components:test
moon run components:test-browser
moon run components:typecheck
moon run components:build
```

Storybook loads the built `dist/`, so run `moon run components:build` after
source changes (its Storybook tasks already depend on the build).

**Framework demos** need the TCP mock plus a rebuild after orchestrator changes —
see [`apps/demo-next/README.md`](../../apps/demo-next/README.md) and
[`apps/demo-nuxt/README.md`](../../apps/demo-nuxt/README.md).

## Testing strategy

Tests are split across two Vitest projects:

- **`unit`** — `jsdom`, fast feedback for rendering, Liquid wiring, branding
  validation, sanitiser allowlists, and DOM-level a11y attributes.
- **`browser`** — real Chromium via Playwright, covers behaviour `jsdom` can't
  fake: `ElementInternals` / form-associated state, native form submit
  interception, focus delegation across shadow roots.

Files ending in `.browser.spec.ts` run only in the browser project; everything
else runs in jsdom.

## Related design docs

- [`docs/design/branding/`](../../docs/design/branding/) — token spec, theme,
  template chrome, **and the form-participation ADR**.
- [`docs/design/flowengine/`](../../docs/design/flowengine/) — flow engine,
  step shape, template security, visualizer.

## License

MIT — see [LICENSE](../../LICENSE).
