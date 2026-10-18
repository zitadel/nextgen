---
name: zitadel-sdk-vue
description: >-
  Integrate Zitadel authentication into a Vue 3 single-page app with
  @zitadel/sdk-vue. Use when the user wants to add Zitadel login, logout, or a
  signed-in session card to an existing or custom Vue/Vite SPA — wiring the
  configureZitadel handle, the ZitadelLogin / ZitadelLogout / ZitadelSession
  components, the same-origin backend proxy, and post-sign-in / post-sign-out
  redirects.
---

# @zitadel/sdk-vue

`@zitadel/sdk-vue` provides Vue 3 components wrapping the Zitadel auth UI web
components (`ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`) for client-side
SPAs (Vite, etc.). You configure one project handle with `configureZitadel(...)`
and hand it to the components; they talk to the backend over a same-origin
proxy path.

## When to use

Reach for this skill when integrating Zitadel into an **existing or custom** Vue
app, where you are adding the components by hand.

For a **fresh** scaffold, prefer the CLI instead — it wires the proxy, env, and
components for you:

```sh
npx @zitadel/cli@alpha setup --framework vue --non-interactive --json
```

Use this skill when `setup` is not appropriate (an app with its own structure,
a partial integration, or customizing what the CLI produced).

## Install

```sh
npm install @zitadel/sdk-vue@alpha
```

Peer dependencies: `vue >=3`. Requires TypeScript ≥ 5.0 (the published types use `export type *`).

## Integrate

Configure once with `configureZitadel(...)`, then pass the returned handle as
`:project` to each component. The components register the underlying web
components on import — no Vue plugin or `app.use(...)` is needed.

```vue
<script setup lang="ts">
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-vue';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});
</script>

<template>
  <ZitadelLogin :project="project" purpose="login" postSignInUrl="/" />
</template>
```

Logout and the signed-in session card take the same `:project` handle:

```vue
<ZitadelLogout :project="project" postSignOutUrl="/login" />
<ZitadelSession :project="project" />
```

- `purpose` on `ZitadelLogin` is `"login"` by default (also accepts the other
  flow purposes, e.g. registration).
- `postSignInUrl` / `postSignOutUrl` are where the browser lands after the flow.
- The widgets call `${proxyPath}/…` **same-origin** (default `/__nextgen`), so
  your host must proxy that path to the Zitadel backend. For local development
  you can instead point `proxyPath` straight at the backend cross-origin, e.g.
  `proxyPath: 'http://localhost:8080'` (the `zitadel start` local runtime port).

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

| Prop | Type | Default | Widgets | Description |
| --- | --- | --- | --- | --- |
| `project` | `ZitadelProject` | unset | Login, Logout, Session | The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. |
| `projectId` | `string` | unset | Login, Logout, Session | Project id, read when no `project` handle is passed. |
| `proxyPath` | `string` | `"/__nextgen"` | Login, Logout, Session | Same-origin path the widget calls. |
| `purpose` | `CreateFlowBodyPurpose` | `"login"` | Login | Flow purpose. |
| `flowName` | `string` | unset | Login | Runs the flow definition with this `name`; unset runs the project's default flow for the purpose. |
| `postSignInUrl` | `string` | unset | Login | Where to navigate after a completed sign-in. |
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
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `@flowStep` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `@flowInput` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `@flowComplete` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `@flowRedirect` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `@flowError` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `@signout` |

```vue
<ZitadelLogin :project="project" theme="light" @flowComplete="track" />
```

## Read these, don't guess

The SDK and this skill version independently — discover the real surface before
writing code, and treat it as authoritative over anything here:

- `node_modules/@zitadel/sdk-vue/README.md` — the installed README.
- `node_modules/@zitadel/sdk-vue/dist/index.d.ts` — the TypeScript types: the
  exact exports and every component prop. The public exports are
  `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `configureZitadel`,
  `getApi`, `getZitadelConfig`, the `ZitadelConfig` / `ZitadelProject` types,
  and `businessLocales`.

Check the installed version's props rather than assuming; emitted events and
optional props (`locales`, `lang`, `theme`, `variant`, `suppressHeader`, …)
evolve.

## Gotchas

- **Server rendering.** If your app renders on the server, mount the widget on the client only, after hydration (the `ZitadelLogin` wrapper sets `projectId` and `proxyPath` as element properties, so adding them to the wrapper does not put them in server markup), or use a raw `<zitadel-login>` element with `project-id` and `proxy-path` as attributes, because a widget that starts before its configuration arrives shows an error instead of the flow.
- **Production SPA deployment is not yet supported.** The same-origin proxy path
  must come from your hosting platform, and the CLI cannot scaffold those host
  configs yet (see ADR 036 and zitadel/nextgen#560). The CLI dev proxy covers
  local development only.
- **Same-origin by default.** Unless you override `proxyPath`, the widgets
  expect `/__nextgen` to be proxied to the backend on the same origin — a bare
  SPA with no proxy will fail its auth calls.
- **TypeScript ≥ 5.0 is required**; older compilers choke on the `export type *`
  re-exports in the published type definitions.
