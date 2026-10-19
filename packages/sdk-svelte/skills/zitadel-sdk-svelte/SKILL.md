---
name: zitadel-sdk-svelte
description: >-
  Integrate Zitadel authentication into an existing Svelte or SvelteKit app
  with the @zitadel/sdk-svelte components. Use when the user wants to add login,
  logout, or a signed-in session card to a Svelte 5 / SvelteKit (or Vite SPA)
  project by hand, wire the auth widgets to a backend, or debug the proxy and
  post sign-in/out redirects.
---

# @zitadel/sdk-svelte

`@zitadel/sdk-svelte` ships Svelte 5 components that render the Zitadel auth UI
(`<ZitadelLogin>`, `<ZitadelLogout>`, `<ZitadelSession>`) for client-side SPAs.
The components wrap the `@zitadel/components` custom elements and talk to a
Zitadel backend over a same-origin proxy path.

## When to use

Use this skill for an **existing or custom** Svelte / SvelteKit / Vite app where
you are adding the auth widgets by hand.

If the user is starting fresh, prefer the `zitadel` CLI instead — it scaffolds a
working Svelte app and wires the dev proxy for you:

```sh
npx @zitadel/cli@alpha setup --framework svelte --non-interactive --json
```

## Install

```sh
npm install @zitadel/sdk-svelte@alpha
```

Peer dependencies: `svelte ^5.0.0`. Requires TypeScript ≥ 5.0 (the published types use `export type *`).

## Integrate

The widgets are **browser** components. In SvelteKit, mount them in a
`+page.svelte` (they render client-side). The minimal pattern, from the README:

```svelte
<script lang="ts">
  import { ZitadelLogin, ZitadelLogout, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });
</script>

<ZitadelLogin {project} purpose="login" postSignInUrl="/" />
<ZitadelLogout {project} postSignOutUrl="/login" />
```

- **Configure once** with `configureZitadel({ projectId, proxyPath })` and pass
  the returned `project` to each component.
- **Proxy / same-origin.** The widgets call `${proxyPath}/…` same-origin
  (default `/__nextgen`). For local development you can skip the proxy and point
  `proxyPath` straight at the backend (cross-origin), e.g.
  `proxyPath: "http://localhost:8080"` (the `zitadel start` default port).
- **Post URLs.** `postSignInUrl` (on `ZitadelLogin`) and `postSignOutUrl` (on
  `ZitadelLogout`) are where the browser lands after each flow.
- **Session card.** `<ZitadelSession {project} />` renders the signed-in user.
- **Callbacks** are optional props; see Widget props and events.

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

They also take the standard HTML attributes; the README says how.

| Prop | Type | Default | Widgets | Description |
| --- | --- | --- | --- | --- |
| `project` | `ZitadelProject` | unset | Login, Logout, Session | The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. |
| `projectId` | `string` | unset | Login, Logout, Session | Project id, read when no `project` handle is passed. |
| `proxyPath` | `string` | `"/__nextgen"` | Login, Logout, Session | Same-origin path the widget calls. |
| `purpose` | `CreateFlowBodyPurpose` | `"login"` | Login | Flow purpose. |
| `flowName` | `string` | unset | Login | Runs the flow definition with this `name`; unset runs the project's default flow for the purpose. |
| `postSignInUrl` | `string` | unset | Login | Where to navigate after a completed sign-in. When the page's `next` query parameter names a path on the same origin, as the server SDKs' middleware sets it for a signed-out visit to a protected route, the widget returns there instead. |
| `forcePostSignInUrl` | `boolean` | `false` | Login | Navigates to `postSignInUrl` even when the page's `next` query parameter names a path, for a page that uses `next` for something of its own. |
| `postSignOutUrl` | `string` | unset | Logout, Session | Where to navigate after sign-out. |
| `resumeFlowId` | `string` or `null` | unset | Login | An existing flow's id to resume instead of starting a new flow; unset, `null` or `""` falls back to the `flow` query parameter, and an id that no longer resolves starts a new flow. |
| `variant` | `"widget"` or `"page"` | `"widget"` | Login, Session | `widget` is content-sized and paints no page chrome; `page` claims the viewport, paints the surface background and loads the brand font, and on Login focuses the first field. |
| `theme` | `"light"`, `"dark"` or `"auto"` | unset | Login, Logout, Session | Colour mode. Unset follows the tenant's branding theme on Login, then the variant default (`dark` for `page`, `auto` for `widget`); Logout defaults to `auto`. `auto` follows `prefers-color-scheme`. |
| `suppressHeader` | `boolean` | `false` | Login, Session | Visually hides the widget's own heading block while keeping it in the accessibility tree, for pages that already carry the heading. |
| `suppressPasswordToggle` | `boolean` | `false` | Login | Hides the show/hide button on password fields. |
| `heading` | `string` | `"Signed in as"` | Session | Heading text override. |
| `logoutLabel` | `string` | `"Sign out"` | Session | Logout action label override. |
| `locales` | `Record<string, Partial<Record<string, string>>>` | unset | Login | Copy overrides merged over the builtin dictionaries, keyed by primary language subtag, for example `{ en: { "identifier.title": "Welcome back" } }`. |
| `lang` | `string` | browser language | Login | BCP-47 language override. |

Each widget event reaches the callback in the last column, which receives the event's `detail` payload.

| Widget event | Fires when | Detail | Widgets | Callback |
| --- | --- | --- | --- | --- |
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `onFlowStep` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `onFlowInput` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `onFlowComplete` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `onFlowRedirect` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `onFlowError` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `onSignout` |

```svelte
<ZitadelLogin {project} theme="light" onFlowComplete={(detail) => track(detail)} />
```

## Read these, don't guess

The installed package is authoritative — it and this skill version independently,
so discover against what is installed rather than trusting anything hardcoded
here:

- `node_modules/@zitadel/sdk-svelte/README.md` — the shipped usage doc.
- `node_modules/@zitadel/sdk-svelte/dist/index.d.ts` and the component prop
  types (`ZitadelLoginProps`, `ZitadelLogoutProps`, re-exported from
  `@zitadel/sdk-core/types`) — the exact props, their names, and which are
  optional. Read the types before passing a prop you are unsure of.

The public exports are `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`,
`configureZitadel`, `getApi`, `getZitadelConfig`, `businessLocales`, plus the
`ZitadelConfig` / `ZitadelProject` types.

## Gotchas

- **Server rendering.** If your app renders on the server, mount the widget on the client only, after hydration, or pass `projectId` and `proxyPath` to the `ZitadelLogin` wrapper as strings (it writes them as the `project-id` and `proxy-path` attributes; use those hyphenated names only on a raw `<zitadel-login>` element), because a widget that starts before its configuration arrives shows an error instead of the flow.
- **Production SPA deployment is not yet supported.** The same-origin proxy path
  must come from your hosting platform, and the CLI cannot scaffold those configs
  yet (see ADR 036 and zitadel/nextgen#560). The CLI dev proxy covers local
  development only.
- **`proxyPath` must reach the backend.** A same-origin path needs a proxy in
  front of your app; without one, point `proxyPath` at the backend origin
  directly (dev only, cross-origin).
- **Browser web components.** The widgets only start in the browser. A SvelteKit
  server render emits a bare element, so follow the server-rendering gotcha
  above: string `projectId` and `proxyPath` may be server-rendered.
