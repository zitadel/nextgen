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
