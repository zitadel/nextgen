# @zitadel/components

Lit-based atomic web components and the `<zitadel-login>` orchestrator for the
Zitadel auth UI.

The package exports:

- **Atoms** — `<zl-field>`, `<zl-button>`, `<zl-alert>`, `<zl-icon>`,
  `<zl-pill>`, `<zl-card>`, `<zl-page-shell>`. Form-associated, accessible,
  branding-aware Lit elements that map 1:1 to the flow API
  field/action/error primitives and the Figma design system.
- **Orchestrator** — `<zitadel-login>`. A single drop-in element that calls
  the flow API, renders each step through a Liquid template, manages focus
  and form submission, and applies branding/theme/locale.
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

<zitadel-login id="login" purpose="login"></zitadel-login>
```

What `<zitadel-login>` handles for you:

- `POST /flow` on mount, `POST /flow/{id}/submit` for every step, terminal
  `redirect` / `show` honoured automatically.
- Native `<form>` semantics: Enter submits, password managers see the inputs,
  `<button type="submit">` works, browser autofill works.
- Focus moved to the first field on every step change.
- Branding tokens mapped to CSS variables on the shadow root.
- Light/dark theme via `prefers-color-scheme`, hot-swappable.
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
- **Dev playgrounds / browser (`msw/browser`)** — `setupMock(worker)`; see
  [`dev/main.ts`](dev/main.ts) for a working setup. `applyBranding(...)`
  injects a tenant branding overlay merged into every response (presets
  include `font_url` for Inter).
- **Framework demos (TCP server)** — `corepack pnpm nx start @zitadel/api-mock`
  serves the same handlers on port 4000 with `defaultDevBranding` (Arimo
  `font_url`) applied at boot. See [`apps/demo-next`](../../apps/demo-next/README.md)
  and [`apps/demo-nuxt`](../../apps/demo-nuxt/README.md).

### Two preview surfaces

Two places run the components against `@zitadel/api-mock`. They
have different jobs — keep both:

| Surface | Nx command | URLs | What it gives you |
| --- | --- | --- | --- |
| **Lit playground** | `corepack pnpm nx dev @zitadel/components` | [login](http://localhost:5173/?route=login) · [atoms](http://localhost:5173/?route=atoms) | Component author surface: branding presets, event log, source TS from `src/`. MSW runs in the browser — no TCP mock server. |
| **React console playground** | `corepack pnpm nx dev @zitadel/console` | [http://localhost:5174](http://localhost:5174) | `@zitadel/ui-react` atom matrices in the pre-release console shell. MSW in `import.meta.env.DEV`. Compare against Lit `:5173/?route=atoms` in a second tab. |
| **demo-next** | `corepack pnpm nx start @zitadel/api-mock` + `ZITADEL_URL=http://localhost:4000 corepack pnpm nx dev @zitadel/demo-next` | [http://localhost:3002/login](http://localhost:3002/login) (mock on `:4000`) | Next.js SDK, middleware, cookies, built `dist/`. See [`apps/demo-next`](../../apps/demo-next/README.md). |
| **demo-nuxt** | mock on `:4000`, then `ZITADEL_URL=http://localhost:4000 corepack pnpm nx dev @zitadel/demo-nuxt` | [http://localhost:3001/login](http://localhost:3001/login) | Nuxt SDK, middleware, cookies, built `dist/`. See [`apps/demo-nuxt`](../../apps/demo-nuxt/README.md). |

The Lit dev playground iterates on `<zl-*>` source; the React console
playground exercises `@zitadel/ui-react` in the internal shell.
When tweaking Lit visuals or shadow-DOM behaviour, use `:5173` first —
it round-trips faster. For React pair tweaks, use `:5174`.

**Stale Lit styles on `:5173`?** Atom `.ts` changes use
`vite-plugin-web-components-hmr` (Lit HMR). Edits to `shared-component-styles`
CSS alone trigger a full reload. If it still looks old, run
`corepack pnpm nx dev:clean @zitadel/components` and hard-refresh.
Console (`:5174`) will not pick up Lit-only edits until you rebuild or
change the paired React/CSS path.

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
| Tokens | branding payload returned from the server | tenant colour / logo / font |
| CSS hooks | `zitadel-login::part(form)`, `zl-field::part(input)` | targeted overrides from the host page |
| Locale | `el.lang = 'de'` / `el.locales = { ... }` | i18n / custom copy |
| MSW mocks | `setupWorker` / `setupServer` from `msw` | offline / staging / fixtures |
| Custom template | (planned) | tenant-supplied Liquid layouts |
| Atoms-only | hand-built form | non-standard flow shells |

Automation can use the stable host and native shadow-root hooks that the default
template emits, for example `zitadel-field-email`, `zitadel-field-email-input`,
and `zitadel-action-submit-button`.

A tenant Liquid template can already be supplied through the branding
payload's `liquid_template` field; a dedicated declarative `template`
surface on `<zitadel-login>` is not yet exposed. The orchestrator otherwise
renders the bundled `default.liquid`. Tracked as a follow-up.

## Element APIs

### `<zitadel-login>`

| Property | Type | Notes |
| --- | --- | --- |
| `purpose` | `'login' \| 'register' \| 'reset_password' \| string` | Which flow purpose to drive |
| `project` | `ZitadelProject` | SDK handle from `configureZitadel()`. Object property (not an attribute). When unset, the element falls back to the global handle from `getZitadelConfig()` |
| `lang` | `string` | BCP 47 tag (e.g. `"de"`, `"en-US"`). Resolves to a built-in dictionary; falls back to `<html lang>` / `navigator.language` |
| `locales` | `Record<string, Locale>` | Custom locale dictionaries keyed by language code; spread over the built-in dictionary so partial overrides work |
| `postSignInUrl` / `post-sign-in-url` | `string` | After `complete: "show"`, exchange the `handoff_token` for a session cookie and navigate here |
| `resumeFlowId` / `resume-flow-id` | `string` | Resume an existing flow handle instead of starting fresh |

Events: `zitadel-flow-input`, `zitadel-flow-step`, `zitadel-flow-complete`,
`zitadel-flow-error`. The orchestrator exposes `::part(form)` for tenant-side
CSS hooks. Adopts design tokens and `branding.font_url` into its shadow root
on each update.

### `<zitadel-logout>`

Session menu / sign-out control for embedded apps. Reads the
`__nextgen_display` cookie set during sign-in, calls `revokeMySession`
(`DELETE /sessions/me`) through the SDK handle, and clears the session. Uses
the same token adoption as `<zitadel-login>` (`applyBaseTokens`).

| Property | Type | Notes |
| --- | --- | --- |
| `project` | `ZitadelProject` | SDK handle from `configureZitadel()`. Object property; falls back to the global handle from `getZitadelConfig()` |
| `postSignOutUrl` / `post-sign-out-url` | `string` | Navigate here after sign-out |
| `clientId` / `client-id` | `string` | Optional OIDC client id forwarded to `getEndSessionUrl()` |

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
├── dev/                   Vite playground (atoms + login routes)
│   ├── index.html
│   ├── main.ts            bootstraps @zitadel/api-mock + MSW worker
│   ├── branding-presets.ts tenant-style branding payloads
│   └── pages/             atom playground + <zitadel-login> demo
├── src/
│   ├── atoms/             zl-field, zl-button, zl-alert, zl-icon, zl-pill,
│   │                       zl-card, zl-page-shell + tests
│   ├── orchestrator/      <zitadel-login>, <zitadel-logout>, api-client, liquid, branding
│   │   ├── locales/       bundled English fallback
│   │   └── templates/     default.liquid (all steps) + layout-chrome.css
│   ├── tokens/            re-export of @zitadel/design-tokens
│   ├── styles/            shared host styles, focus ring, t() css-var bridge
│   ├── manifests.ts       per-atom attribute / part / event manifests
│   └── index.ts           barrel
├── tsdown.config.ts       library build (externalises lit/liquidjs/dompurify)
├── vite.config.mts        dev server
└── vitest.config.ts       jsdom (unit) + chromium (browser) projects
```

## Develop

Use **Nx** for tasks in this monorepo (`corepack pnpm nx <target> <project>`).
It matches CI caching and dependency order. Equivalent `pnpm --filter …` scripts
still exist on some packages, but Nx is the documented path.

```sh
# install once at the repo root
corepack pnpm install

# --- Playgrounds (two terminals) ---

# Lit: atoms + login, in-browser MSW
corepack pnpm nx dev @zitadel/components
# → http://localhost:5173/?route=login
# → http://localhost:5173/?route=atoms

# React console: ui-react atom playground (compare to Lit ?route=atoms in another tab)
corepack pnpm nx dev @zitadel/console
# → http://localhost:5174

# Framework demos (TCP mock + SDK) — see apps/demo-*/README.md
# corepack pnpm nx start @zitadel/api-mock   # → http://localhost:4000
# ZITADEL_URL=http://localhost:4000 corepack pnpm nx dev @zitadel/demo-next  # → :3002
# ZITADEL_URL=http://localhost:4000 corepack pnpm nx dev @zitadel/demo-nuxt  # → :3001

# --- Package checks ---

corepack pnpm nx test @zitadel/components
corepack pnpm nx test:browser @zitadel/components
corepack pnpm nx typecheck @zitadel/components
corepack pnpm nx build @zitadel/components
```

The components dev server imports source TS from `src/` and hot-reloads on edits.
Run `build` when testing the published `dist/` shape (demos and npm consumers).

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
