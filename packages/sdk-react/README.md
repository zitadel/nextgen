# @zitadel/sdk-react

React components for the Zitadel auth UI, for client-side SPAs.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```tsx
import {
  ZitadelLogin,
  ZitadelLogout,
  configureZitadel,
} from '@zitadel/sdk-react';

// Configure once, before rendering. The handle is passed to the widget as a
// prop, so it has config the moment it mounts.
const project = configureZitadel({
  projectId: '<your project id>', // e.g. from your bundler's env (import.meta.env, process.env, …)
  proxyPath: '/__nextgen', // same-origin path your deploy proxies to the backend
});

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}

export function ProfilePage() {
  return <ZitadelLogout project={project} postSignOutUrl="/login" />;
}
```

The signed-in session card is `<ZitadelSession project={project} />` (exported
as `ZitadelSession`).

`ZitadelLogin` takes the callbacks `onFlowStep`, `onFlowInput`, `onFlowComplete`,
`onFlowRedirect` and `onFlowError`; `ZitadelLogout` and `ZitadelSession` take
`onSignout`, `onSessionMissing` (the visitor has no session: the widget renders nothing, and the session card
goes to its `postSignOutUrl` when one is set) and `onSessionError` (loading the session or signing out failed
some other way, such as a 5xx or a network error; the detail has `phase`, `message` and, when a response came
back, `status` and `code`). Each receives the event detail. An unset or cleared prop leaves
the widget on its default (for example the "Signed in as" heading).

`ZitadelLogin` also takes `resumeFlowId` (an existing flow to resume instead of starting a new
one), like every other SDK's login wrapper, and the operator-preview props `previewState` and
`previewSuccessStep`, which only the React wrapper exposes: they exist for the console's branding
preview, not for a sign-in page.

Children go into the element's light DOM, so `ZitadelLogout` accepts a
`<template>` for a custom sign-out control (`{{display}}`, `{{identifier}}`
and `{{initial}}` are filled in, and an element with `data-action="logout"`
signs out), and `ZitadelLogin` accepts content for its
`slot="attribution-trailing"` slot. `ZitadelSession` takes no children: its
element has no slot to show them in. JSX reads `{{display}}` as an object
literal, so write each placeholder inside a string literal:

```tsx
<ZitadelLogout project={project}>
  <template>
    <button type="button" data-action="logout">
      {"Sign out {{display}}"}
    </button>
  </template>
</ZitadelLogout>
```

The package is marked `"use client"`, so a Next.js App Router server component
can render the widgets directly.

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
