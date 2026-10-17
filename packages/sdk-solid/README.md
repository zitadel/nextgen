# @zitadel/sdk-solid

Solid components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```tsx
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-solid';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});

export default function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}
```

`<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.

The signed-in session card is `<ZitadelSession project={project} />` (exported as `ZitadelSession`).

The widgets' events are also surfaced as optional callbacks:

- `ZitadelLogin`: `onFlowStep`, `onFlowInput`, `onFlowComplete`, `onFlowRedirect`, and
  `onFlowError`.
- `ZitadelLogout` and `ZitadelSession`: `onSignout`, `onSessionMissing` (the visitor has no
  session: the widget renders nothing, and the session card goes to its `postSignOutUrl` when
  one is set) and `onSessionError` (loading the session or signing out failed some other way,
  such as a 5xx or a network error; the detail has `phase`, `message` and, when a response came
  back, `status` and `code`).

Leaving a prop unset, or setting it back to `undefined`, keeps the element's own default (for
example the session card's "Signed in as" heading).

`ZitadelLogin` also takes `resumeFlowId`, an existing flow to resume instead of starting a new
one. Unset, `null` or `""` falls back to the `flow` query parameter.

Children are rendered into the element. Give `ZitadelLogout` a `<template>` child to replace its
avatar menu with your own markup, filled with `{{display}}`, `{{identifier}}` and `{{initial}}`,
where any `data-action="logout"` element signs out. Content with `slot="attribution-trailing"`
inside `ZitadelLogin` is shown next to its attribution. `ZitadelSession` takes no children: its
element has no slot to show them in.

```tsx
<ZitadelLogout project={project}>
  <template>
    <button type="button" data-action="logout">{'Sign out {{display}}'}</button>
  </template>
</ZitadelLogout>
```

## Server rendering

The package ships a `solid` export condition with uncompiled JSX, so `vite-plugin-solid` compiles
it for each environment (server and hydrating client). Importing it in a SolidStart route is
safe during SSR. The `project` handle, `locales`, `lang` and `suppressHeader` are set only as
properties, so they are not in the server markup; the client sets them while hydrating. The other
props are rendered as attributes, and the element reads them when it upgrades.

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
