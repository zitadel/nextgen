# BDUI Renderer

> **Status:** Concept doc, not an implementation spec. Revised 2026-08-11.
> **Where this stands:** the core bet landed, in a different shape than first
> sketched. The Lit web components shipped in
> [`packages/components`](../../../packages/components) as the
> `<zitadel-login>` / `<zitadel-logout>` / `<zitadel-session>` orchestrators,
> and the framework SDKs (`sdk-react`, `sdk-vue`, `sdk-angular`, …) wrap them.
> Scaffolding goes through the orca patchers
> (`apps/cli/src/lib/orca/patchers/rule/<framework>/`) with renderer ids
> `react` (available) and `web-component` (declared, deliberately unavailable —
> the `lit/` placeholder spec reserves the integration shape for a future
> standalone `@zitadel/ui-lit` renderer). What follows is the concept; shipped
> deviations are noted inline.
> **See also:** [CLI Plan](PLAN.md) · [Flow Engine](../flowengine/flow-engine.md) · [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md)

## Problem

The product vision says "CLI figures out the framework and can later plug in the [Lit] web component." The original POC's adapter hardcoded a React import:

```tsx
// the pre-orca adapter layer (since replaced by
// apps/cli/src/lib/orca/patchers/rule/next/)
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

1. `POST /flow` with `{ purpose, auth_request_id?, hint? }` to start a flow.
2. Receives a step response with **ordered capability arrays** for `fields` and `actions` (entries carry a `name`; [ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md)), a keyed `gates` map, optional `sso_providers`, step-level `texts.{title_key, description_key}`, and a **`branding.liquid_template` string**.
3. Renders the step by **executing the Liquid template** against those capabilities as context. The template iterates the arrays or looks entries up by name (`where: "name"`); it controls element ordering, grouping, and layout — the component never decides "email first, then password."
4. Resolves every `text_key` through the `| t` LiquidJS filter against the active locale dictionary loaded at boot.
5. Sanitizes the rendered HTML (DOMPurify) and injects it into the Shadow DOM.
6. Mounts `<zl-*>` web components emitted by the template: `<zl-field>`, `<zl-action>`, `<zl-captcha>`, `<zl-passkey>`, `<zl-sso>`.
7. On submit, collects field values from `<zl-field>` and gate proofs from `<zl-captcha>` / `<zl-passkey>`; POSTs `{ action, fields, gate_proofs?, sso_provider_id? }` to `/flow/{id}/submit` — note `fields` (object), not `data`.
8. Applies the response: next step, or redirect on completion.

Step rendering is the whole job, but rendering is now **Liquid execution**, not array iteration. The capability contract is defined by [flow-engine-nodes.md](../flowengine/flow-engine-nodes.md); the renderer implements that contract and nothing else.

## Why web components

**Framework-agnostic.** One implementation, not one per ecosystem. A React consumer, a Vue consumer, and a vanilla-HTML consumer see the same component. (Shipped deviation: the `@zitadel/sdk-*` packages do exist, but as thin wrappers over the shared `@zitadel/components` web components — the single-implementation goal held; the wrappers only add framework ergonomics and the proxy/session plumbing.)

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

**Per-renderer template selection** in the patcher (shipped layout):

```
apps/cli/src/lib/orca/patchers/rule/next/
├── index.ts
└── renderers/
    ├── registry.ts        # AVAILABLE_RENDERER_IDS — react | web-component
    ├── react/
    └── lit/               # declares id "web-component", status not-implemented
```

Contract test: every (patcher × renderer) pair produces a valid scaffold that typechecks.

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
{% for f in fields %}
  <zl-field
    name="{{ f.name }}"
    type="{{ f.type }}"
    label="{{ f.text_key | t }}"
  ></zl-field>
{% endfor %}
```

Missing keys fall through to the raw key at render time — useful for debugging and for bespoke schema fields. (Shipped deviation: there is no `.zitadel/locales/` directory and no `zitadel locale` command — copy customization ships as branding **copy overlays** per [ADR 045](../../adrs/045-copy-overlays-as-branding-revisions.md).)

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

The CLI should expose the renderer choice as a flag *and* in capabilities once
a second renderer is available (direction — today the shipped knobs are
`setup --design` for the login design and the ADR 044 posture derivation;
there is no `--renderer` flag):

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

- [`packages/sdk-next`](../../../packages/sdk-next) hosts the shared web components with a framework-ergonomic API — this landed: the SDKs mount `<zitadel-login>` from [`packages/components`](../../../packages/components).
- The adapter layer split into per-renderer templates — this landed as the orca patchers (`apps/cli/src/lib/orca/patchers/rule/<framework>/renderers/`).
- A future package, `packages/ui-lit/`, remains the reserved home of a standalone `<zitadel-flow>` renderer. Out-of-scope to build — the name and the component contract are committed (the `lit/` renderer placeholder reserves the shape) so downstream work can start against the interface.

## Open questions

- **`<zitadel-flow>` vs multiple components.** Resolved in practice the other way: the shipped orchestrators are purpose-specific (`<zitadel-login>`, `<zitadel-logout>`, `<zitadel-session>`). A future standalone `<zitadel-flow>` would fold them back into one omnibus component; whether that is worth it is open.
- **Attribute vs. slot for theming.** Strong bias toward CSS custom properties for style and slots for content. Attributes like `title`, `logo-src` are handy but drift toward content-as-props. Prefer slots.
- **Token storage.** The flow completes and returns tokens. Where do they go? Browser session, HTTP-only cookie, hand off to the framework? Default: Zitadel issues an HTTP-only cookie on successful flow completion. The component never exposes the token to JS. Frameworks get `useSession()` via the sdk-next/vue/etc packages.
- **Server components / RSC.** Next.js App Router's server components expect render-on-server. `<zitadel-flow>` must render both server-side (declarative shadow DOM) and hydrate client-side without double-fetch. Needs a spike.
- **Timing vs. Lit readiness.** This doc commits us to "Lit eventually." If the Lit work slips six months, the React shim must ship feature-complete. The shim should therefore implement the *full* BDUI contract today, so Lit is a substitution, not a re-architecture.
