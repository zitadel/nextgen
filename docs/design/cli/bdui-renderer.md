# BDUI Renderer

> **Status:** Draft — concept doc, not an implementation spec.
> **Date:** 2026-04-23
> **See also:** [CLI Plan](PLAN.md) · [Flow Engine](../flowengine/flow-engine.md) · [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md)

## Problem

The product vision says "CLI figures out the framework and can later plug in the [Lit] web component." The POC's adapter hardcodes a React import:

```tsx
// apps/cli/src/adapters/next/adapter.ts:69
import { ZitadelFlow } from "@zitadel/sdk-next";
export default function LoginPage() {
  return <ZitadelFlow purpose="login" />;
}
```

This framing is wrong in two ways, and reading the [flow engine](../flowengine/flow-engine.md) makes it clear why:

1. **There is no "login component" that owns its own logic.** The flow engine produces [BDUI](../flowengine/flow-engine.md) — server-driven step trees. The frontend's only job is to render what the server sends, collect input, and post it back. A component that hardcodes "email → password → submit" is a lie; the server decides.
2. **Lit isn't a framework. It's a renderer.** Lit ships web components. Web components work in React, Vue, Svelte, Angular, and vanilla HTML. The decision isn't "pick a framework"; it's "the renderer is a web component, and every framework adapter hosts it."

Re-framing: **the CLI scaffolds framework-native routes; those routes mount a BDUI renderer; the target renderer is a web component.** React consumers use a temporary `ZitadelFlow` shim until the web component package ships.

## What the renderer actually does

A single web component — call it `<zitadel-flow>` — takes enough input to talk to the flow engine and renders whatever step the server returns.

```html
<zitadel-flow
  purpose="login"
  issuer="https://project-river.zitadel.app"
  client-id="web-frontend"
  redirect-uri="/callback"
></zitadel-flow>
```

Under the hood the component:

1. `POST /v1/flows` with `{ purpose, auth_request_id?, hint? }` to start a flow.
2. Receives a step response with **three unordered capability dicts** (`fields`, `actions`, `gates`), optional `sso_providers`, step-level `texts.{title_key, description_key}`, and a **`branding.liquid_template` string**.
3. Renders the step by **executing the Liquid template** against the capability dicts as context — not by iterating arrays. The template controls element ordering, grouping, and layout; the component never decides "email first, then password."
4. Resolves every `text_key` through the `| t` LiquidJS filter against the active locale dictionary loaded at boot.
5. Sanitizes the rendered HTML (DOMPurify) and injects it into the Shadow DOM.
6. Mounts `<zl-*>` web components emitted by the template: `<zl-field>`, `<zl-action>`, `<zl-captcha>`, `<zl-passkey>`, `<zl-sso>`.
7. On submit, collects field values from `<zl-field>` and gate proofs from `<zl-captcha>` / `<zl-passkey>`; POSTs `{ action, fields, gate_proofs?, sso_provider_id? }` to `/v1/flows/{session_id}/submit` — note `fields` (object), not `data`.
8. Applies the response: next step, or redirect on completion.

Step rendering is the whole job, but rendering is now **Liquid execution**, not array iteration. The capability contract is defined by [flow-engine-nodes.md](../flowengine/flow-engine-nodes.md); the renderer implements that contract and nothing else.

## Why web components

**Framework-agnostic.** One renderer implementation, not one renderer per ecosystem. React, Vue, Angular, and vanilla-HTML consumers should see the same component contract; framework SDKs stay thin adapters around that shared surface.

**Stable output.** The shadow DOM encapsulates our styles. Customer Tailwind / CSS resets / design systems do not mangle our login UI. For customers who want to restyle, we expose CSS custom properties (`--zitadel-primary-color`, `--zitadel-border-radius`) and slots for branded header/footer.

**Works with SSR.** Lit's declarative shadow DOM ships in browsers now. Next.js App Router, Remix, SvelteKit, Nuxt, Astro — all can render the component server-side.

**Lowest integration cost for agents.** An agent dropping auth into an unfamiliar codebase writes three lines of HTML, not a React provider, a hook, and a wrapper.

## Framework adapter contract

The CLI's framework adapter's job shrinks to:

1. Scaffold the route(s) in the idiomatic place (`app/login/page.tsx`, `pages/login.vue`, `src/routes/login/+page.svelte`, `pages/login.astro`).
2. Mount `<zitadel-flow>` inside that route.
3. Pass runtime env (`ZITADEL_ISSUER`, `ZITADEL_CLIENT_ID`) as attributes.
4. Register `@zitadel/ui-lit` as a dependency.

```tsx
// Next.js — React consumer
import "@zitadel/ui-lit";

export default function LoginPage() {
  return (
    <zitadel-flow
      purpose="login"
      issuer={process.env.NEXT_PUBLIC_ZITADEL_ISSUER}
      client-id={process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID}
    />
  );
}
```

```vue
<!-- Vue consumer -->
<script setup>
import "@zitadel/ui-lit";
</script>

<template>
  <zitadel-flow
    purpose="login"
    :issuer="issuer"
    :client-id="clientId"
  />
</template>
```

The adapter no longer decides what the login screen looks like. It only decides *where the route lives* and *how to import the component*.

## The renderer abstraction in zitadel.json

The renderer choice is explicit in config, not inferred:

```json
{
  "$schema": "https://schemas.zitadel.com/v2/project.schema.json",
  "branding": {
    "renderer": "web-component",
    "attribution": "visible",
    "theme": { "primary_color": "#0066cc", "border_radius": "8px" }
  }
}
```

`renderer` values:

| Value | Meaning | Ships when |
|---|---|---|
| `"web-component"` | `<zitadel-flow>` web component | When the web-component package is published |
| `"react"` | React shim using the same `ZitadelFlow` vocabulary | Today |
| `"default"` | CLI picks based on framework adapter preference | Always — today defaults to `react`, flips to `web-component` when ready |
| `"headless"` | No rendering; user implements their own UI against Session API | Out-of-scope until customers ask |

**Per-renderer template selection** in the adapter:

```
apps/cli/src/adapters/next/
├── adapter.ts
└── renderers/
    ├── react/
    │   ├── login.tsx.tmpl
    │   └── register.tsx.tmpl
    ├── web-component/
    │   ├── login.tsx.tmpl
    │   └── register.tsx.tmpl
    └── headless/
        └── (not yet)
```

Contract test: every (adapter × renderer) pair produces a valid scaffold that typechecks.

## The React shim

Until Lit ships, React consumers get `@zitadel/sdk-next` with the *same* API surface the Lit component will have:

```tsx
import { ZitadelFlow } from "@zitadel/sdk-next";

<ZitadelFlow purpose="login" issuer={...} clientId={...} />
```

Internally this is a React component today; tomorrow it's `createComponent` from `@lit/react` wrapping `<zitadel-flow>`. The consumer's code does not change. That's the "can later plug in the web component" promise the vision demands.

## Localization (text_key + `| t`)

The server never sends display text — it sends semantic keys following the `<step>.<scope>.<name>` convention (e.g. `identifier.field.email`, `credential.action.submit`). The orchestrator ships a custom LiquidJS filter, `| t`, that looks each key up in the active locale dictionary:

```liquid
<h1>{{ step.texts.title_key | t }}</h1>
<zl-field
  name="{{ field[0] }}"
  type="{{ field[1].type }}"
  label="{{ field[1].text_key | t }}"
></zl-field>
```

Locale dictionaries are flat `text_key → string` maps, generated and maintained by the CLI at `.zitadel/locales/<lang>.json`. `zitadel setup` seeds `en.json`; `zitadel locale scaffold [--lang de]` walks current flows and adds any missing keys as empty strings. Missing keys fall through to the raw key at render time — useful for debugging and for bespoke schema fields.

## Template security

The renderer consumes a tenant-editable Liquid template via `innerHTML`. Security is defense-in-depth; see [flow-engine/template-security.md](../flowengine/template-security.md) for the full model. CLI-side invariants enforced on `zitadel apply`:

| Check | Rule |
|---|---|
| Banned filter | `| raw` disables auto-escaping; never allowed in tenant-editable templates. |
| Banned tag | `<script>` rejected on sight. |
| Banned attribute | Any attribute starting with `on` (e.g. `onerror=`, `onclick=`) rejected — these fire when HTML is injected via `innerHTML` even after sanitization. |
| Allowed tags | Standard HTML subset plus `<zl-field>`, `<zl-action>`, `<zl-captcha>`, `<zl-passkey>`, `<zl-sso>`. |

`zitadel apply` parses every `.zitadel/templates/*.liquid` with `liquidjs` and runs the checks above before any network call. Violations surface as `E_VALIDATION` with `details.issues` enumerating each offending construct and its line number.

## Styling and theming

Three layers, in precedence order:

1. **Defaults** — the Lit component ships a self-contained design that matches an unbranded sign-in page. Works out of the box.
2. **CSS custom properties** — consumers set `--zitadel-primary-color`, `--zitadel-font-family`, `--zitadel-border-radius`, etc. Covers ~80% of branding needs.
3. **Slots** — `<slot name="header">` and `<slot name="footer">` for custom markup. Covers logo, marketing copy, legal links.

**No full CSS override.** If a customer needs deeper control, they're telling us they want a different renderer — point them to the Session API and a custom implementation. Supporting "arbitrary CSS" invariably breaks BDUI invariants (e.g. hiding required fields).

## Agent UX

The CLI must expose the renderer choice as a flag *and* in capabilities:

```
zitadel setup --renderer web-component
zitadel set renderer web-component    # post-setup switch
```

Capabilities output advertises available renderers per adapter so agents can match them:

```json
{
  "data": {
    "renderers": [
      { "id": "web-component", "frameworks": ["next", "vue", "svelte", "astro", "vanilla"], "status": "not-implemented" },
      { "id": "react", "frameworks": ["next", "remix"], "status": "available" },
      { "id": "headless", "frameworks": ["*"], "status": "not-implemented" }
    ]
  }
}
```

The CLI's `doctor` command verifies: (a) the renderer package is installed, (b) scaffolded pages import it correctly, (c) runtime env is present.

## What this means for the current POC

- [`packages/sdk-next`](../../../packages/sdk-next) stays, but its real job becomes "host the web component with a React-ergonomic API." The current POC surface is a single `ZitadelFlow` that follows the future `<zitadel-flow>` contract.
- [`apps/cli/src/adapters/next/adapter.ts`](../../../apps/cli/src/adapters/next/adapter.ts) splits into per-renderer templates.
- `zitadel.json#branding.renderer` becomes a first-class field, not a placeholder.
- A new package, `packages/ui-lit/`, is created as the home of `<zitadel-flow>`. Out-of-scope for this plan to build — just commit to the package name and the component contract so downstream work can start against the interface.

## Open questions

- **`<zitadel-flow>` vs multiple components.** Should we ship one omnibus component, or `<zitadel-login>` + `<zitadel-register>` + `<zitadel-profile>`? The flow engine's `purpose` field already disambiguates behaviors — one component with a `purpose` attribute is simpler. Going with one.
- **Attribute vs. slot for theming.** Strong bias toward CSS custom properties for style and slots for content. Attributes like `title`, `logo-src` are handy but drift toward content-as-props. Prefer slots.
- **Token storage.** The flow completes and returns tokens. Where do they go? Browser session, HTTP-only cookie, hand off to the framework? Default: Zitadel issues an HTTP-only cookie on successful flow completion. The component never exposes the token to JS. Frameworks get `useSession()` via the sdk-next/vue/etc packages.
- **Server components / RSC.** Next.js App Router's server components expect render-on-server. `<zitadel-flow>` must render both server-side (declarative shadow DOM) and hydrate client-side without double-fetch. Needs a spike.
- **Timing vs. Lit readiness.** This doc commits us to "Lit eventually." If the Lit work slips six months, the React shim must ship feature-complete. The shim should therefore implement the *full* BDUI contract today, so Lit is a substitution, not a re-architecture.
