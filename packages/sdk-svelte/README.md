# @zitadel/sdk-svelte

Svelte 5 components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```svelte
<script lang="ts">
  import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });
</script>

<ZitadelLogin {project} purpose="login" postSignInUrl="/" />
```

`<ZitadelLogout {project} postSignOutUrl="/login" />` works the same way.

The signed-in session card is `<ZitadelSession {project} />` (exported as `ZitadelSession`).

The widget's events are also surfaced as optional callbacks: `ZitadelLogin`
takes `onFlowStep`, `onFlowInput`, `onFlowComplete`, `onFlowRedirect` and
`onFlowError`; `ZitadelLogout` and `ZitadelSession` take `onSignout`,
`onSessionMissing` (the visitor has no session: the widget renders nothing,
and the session card goes to its `postSignOutUrl` when one is set) and
`onSessionError` (loading the session or signing out failed some other way,
such as a 5xx or a network error; the detail has `phase`, `message` and, when
a response came back, `status` and `code`). Each receives the event detail. An unset or cleared prop leaves the widget on its
default (for example the "Signed in as" heading).

`ZitadelLogin` also takes `resumeFlowId`, an existing flow to resume instead of starting a new
one. Unset, `null` or `""` falls back to the `flow` query parameter.

Children go into the element's light DOM, so `ZitadelLogout` accepts a
`<template>` for a custom sign-out control (`{{display}}`, `{{identifier}}`
and `{{initial}}` are filled in, and an element with `data-action="logout"`
signs out), and `ZitadelLogin` accepts content for its
`slot="attribution-trailing"` slot. `ZitadelSession` takes no children: its
element has no slot to show them in. Svelte reads `{{display}}` as an
expression, so write each placeholder as a string expression:

```svelte
<ZitadelLogout {project}>
  <template>
    <button data-action="logout">Sign out {'{{display}}'}</button>
  </template>
</ZitadelLogout>
```

The components are browser-only: the package ships client-compiled Svelte, so
rendering them on the server fails. Under SvelteKit, mount them client-side
behind `onMount`, as the [`@zitadel/sdk-sveltekit`](../sdk-sveltekit/README.md)
README shows.

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
