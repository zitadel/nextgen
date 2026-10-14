# @zitadel/sdk-vue

Vue 3 components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

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

The signed-in session card is `<ZitadelSession :project="project" />` (exported as `ZitadelSession`).

`ZitadelLogin` emits `flowStep`, `flowInput`, `flowComplete`, `flowRedirect` and
`flowError` (listen with `@flow-step` and so on); `ZitadelLogout` and
`ZitadelSession` emit `signout`, `sessionMissing` (listen with
`@session-missing`; the visitor has no session: the widget renders nothing, and the session card
goes to its `postSignOutUrl` when one is set, unless that URL is the page it is on) and
`sessionError` (listen with `@session-error`; loading the session or signing out failed some other
way, such as a 5xx or a network error, and the detail has `phase`, `message` and, when a response
came back, `status` and `code`). Each
payload is the event detail. An unset or
cleared prop leaves the widget on its default (for example the "Signed in as"
heading).

The default slot goes into the element's light DOM, so `ZitadelLogout` accepts a
`<template>` for a custom sign-out control (`{{display}}`, `{{identifier}}` and
`{{initial}}` are filled in, and an element with `data-action="logout"` signs
out), and `ZitadelLogin` accepts content for its `slot="attribution-trailing"`
slot. `ZitadelSession` takes no slot content: its element has no slot to show it in. Vue compiles `{{display}}` as its own interpolation (to an empty string),
so mark the template `v-pre` to hand the placeholders to the element as written:

```vue
<ZitadelLogout :project="project">
  <template v-pre>
    <button data-action="logout">Sign out {{display}}</button>
  </template>
</ZitadelLogout>
```

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
