# @zitadel/sdk-vue

Vue 3 components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Installation

```bash
pnpm add @zitadel/sdk-vue@alpha
```

## Requirements

Peer dependencies: `vue >=3.2`.

TypeScript ≥ 5.0, the floor shared by every SDK; see the [compatibility notes](https://github.com/zitadel/nextgen/blob/main/packages/AGENTS.md).

## Usage

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

`<ZitadelLogout :project="project" postSignOutUrl="/login" />` works the same way.

`ZitadelLogin` also takes `resumeFlowId`, an existing flow to resume instead of starting a new one; unset, `null` or `""` falls back to the `flow` query parameter.

The signed-in session card is `<ZitadelSession :project="project" />` (exported as `ZitadelSession`).

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

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
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `@flowStep` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, secret: false, value }`, or `{ name, secret: true }` for a secret field | Login | `@flowInput` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `@flowComplete` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `@flowRedirect` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `@flowError` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `@signout` |

A secret field is a password, a one-time or recovery code, or any field the step defines as one. The `zitadel-flow-input` event is composed, so any script on the page can read it, and for a secret field its detail therefore carries the field's `name` and `secret: true` but never the value. Narrow on `secret` before reading `value`.

```vue
<ZitadelLogin :project="project" theme="light" @flowComplete="track" />
```

## Standard HTML attributes

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` also take the standard HTML attributes (`class`, `style`, `id`, `title`, `slot`, `hidden`, `role`, `tabindex`, `data-*` and `aria-*`) and pass them to the widget element, so you can position, style and label the widget without an extra wrapper element. Nothing else reaches the element: any other prop is ignored.

```vue
<ZitadelLogin :project="project" class="login" data-testid="login" aria-label="Sign in" />
```

Vue's `strictTemplates` rejects `data-*` attributes on a component whose props type does not declare them, and this one cannot declare them without breaking Vue's own overloads.

## Server rendering

If your app renders on the server, mount the widget on the client only, after hydration (the `ZitadelLogin` wrapper sets `projectId` and `proxyPath` as element properties, so adding them to the wrapper does not put them in server markup), or use a raw `<zitadel-login>` element with `project-id` and `proxy-path` as attributes, because a widget that starts before its configuration arrives shows an error instead of the flow.

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). In
production the same-origin path must come from your hosting platform — until
the CLI can scaffold those configs, **production SPA deployment is not yet
supported**; see
[ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md)
and [zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560). The
CLI dev proxy covers local development.

For local development you can also skip the proxy and point `proxyPath`
straight at the backend (cross-origin), e.g. `proxyPath: "http://localhost:8080"`
(the `zitadel start` local runtime default port).
