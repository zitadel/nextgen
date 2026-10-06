---
name: zitadel-sdk-react
description: >-
  Integrate Zitadel authentication into an existing React app with
  `@zitadel/sdk-react`. Use when adding Zitadel login, registration, logout, or
  session handling to a client-side React / Vite SPA or a TanStack
  (Router/Start) app — wiring the `ZitadelLogin`, `ZitadelLogout`, and
  `ZitadelSession` auth-UI components into pages you already have.
---

# @zitadel/sdk-react

React wrappers around the Zitadel auth-UI web components, for client-side SPAs.

## When to use

Use this skill to drop the Zitadel auth UI into an **existing or custom** React
app — your own routes, your own bundler (Vite, TanStack Start, etc.) — by
rendering the SDK's components on your login/profile pages.

If the user instead wants a **fresh** app scaffolded, the CLI does that:
`zitadel setup --framework react` generates a wired React project. Reach for
this skill when there is already an app to integrate into and the CLI's
scaffolding would overwrite or not fit it.

## Install

```sh
npm install @zitadel/sdk-react
```

Peer dependencies (you almost certainly already have them): `react >=18` and
`react-dom >=18`. TypeScript projects need **TypeScript ≥ 5.0**.

## Integrate

Call `configureZitadel(...)` once before rendering and pass the returned handle
as the `project` prop. The SPA renders after configuration, so the handle is
present when the underlying web component upgrades.

```tsx
import {
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
  configureZitadel,
} from "@zitadel/sdk-react";

// Configure once, module scope, before rendering.
const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID, // or your env source
  proxyPath: "/__nextgen", // same-origin path your deploy proxies to the backend
});

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}

export function ProfilePage() {
  return (
    <>
      <ZitadelSession project={project} />
      <ZitadelLogout project={project} postSignOutUrl="/login" />
    </>
  );
}
```

- `purpose` defaults to `"login"`; set it for other flows.
- `postSignInUrl` / `postSignOutUrl` are where the widget sends the user after
  the flow completes.
- The components forward the widget's `zitadel-*` events as optional `on*`
  callbacks (e.g. `onFlowComplete`, `onSignout`) if you need to react in-app.

## Read these, don't guess

This skill is the integration **pattern**, not an API catalog — exact names,
props, and defaults are authoritative only at the source. Before relying on a
specific prop or export, read:

- `node_modules/@zitadel/sdk-react/README.md` — the installed package's own docs.
- The package's TypeScript types (`node_modules/@zitadel/sdk-react/dist/index.d.ts`
  and its re-exported `@zitadel/sdk-core/types`) — the authoritative list of
  exported components, props, and event-detail shapes.

Discover from those rather than assuming; the package and this skill version
independently and a hardcoded API list here would drift.

## Gotchas

- **TypeScript ≥ 5.0 required** — the published types use `export type *`, which
  older TypeScript cannot parse.
- **Client-side only.** These wrap browser web components; render them in the
  client, not during server rendering.
- **Same-origin proxy.** The widgets call `${proxyPath}/…` same-origin (default
  `/__nextgen`). Your deployment must proxy that path to the Zitadel backend.
  Production SPA deployment is not yet fully supported — see
  [ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md)
  and [zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560). The
  CLI dev proxy covers local development.
- **Local dev without a proxy.** You can point `proxyPath` straight at the
  backend cross-origin, e.g. `proxyPath: "http://localhost:8080"` (the
  `zitadel start` default port).
- **Configure before render.** Build the handle with `configureZitadel(...)` at
  module scope and pass it as `project`, so it is set when the element upgrades.
