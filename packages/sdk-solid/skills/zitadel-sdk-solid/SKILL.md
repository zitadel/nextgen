---
name: zitadel-sdk-solid
description: >-
  Integrate Zitadel authentication into a SolidJS app with
  `@zitadel/sdk-solid`. Use when the user wants to add Zitadel login,
  registration, logout, or a signed-in session card to an existing or
  custom Solid SPA (Vite, SolidStart, etc.) — wiring `configureZitadel`
  and the `<ZitadelLogin>` / `<ZitadelLogout>` / `<ZitadelSession>`
  components by hand rather than scaffolding from scratch.
---

# @zitadel/sdk-solid

Solid components that render the Zitadel auth UI inside a client-side SPA.
The package wraps the framework-agnostic `<zitadel-*>` web components as
real Solid components, so login, logout, and the signed-in session card are
JSX you drop into your routes.

## When to use

- **Fresh project:** prefer the CLI. `zitadel setup --framework solid`
  scaffolds a wired Solid app (and the dev proxy) for you — see the
  `zitadel-cli` skill. Don't hand-assemble what the CLI generates.
- **This skill:** an app that already exists, or a custom integration the
  scaffold doesn't cover — adding auth to a Solid app you already have,
  moving the components into your own routes, or wiring the config yourself.

## Install

`solid-js >= 1.6` is a peer dependency, and the published types need
TypeScript >= 5.0.

```sh
npm install @zitadel/sdk-solid
```

## Integrate

Configure once, then render the components. `configureZitadel` returns a
project handle you pass to each component.

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

Logout and the signed-in session card take the same `project` handle:

```tsx
import { ZitadelLogout, ZitadelSession } from '@zitadel/sdk-solid';

<ZitadelLogout project={project} postSignOutUrl="/login" />;
<ZitadelSession project={project} />;
```

`purpose` selects the flow (`"login"`, etc.); `postSignInUrl` /
`postSignOutUrl` are where the widget navigates after the flow completes.
Flow events are surfaced as optional callbacks — `onFlowStep`,
`onFlowInput`, `onFlowComplete`, and `onFlowError` — when you need to react
to the flow yourself.

**Same-origin proxy.** The widgets call `${proxyPath}/…` same-origin
(default `/__nextgen`). For local development the CLI dev proxy covers this;
you can also skip the proxy and point `proxyPath` straight at the backend
cross-origin, e.g. `proxyPath: "http://localhost:8080"` (the `zitadel start`
local runtime default port).

## Read these, don't guess

Treat the installed package as authoritative over anything here — this skill
and the package version move independently.

- `node_modules/@zitadel/sdk-solid/README.md` — the shipped usage doc.
- `node_modules/@zitadel/sdk-solid/dist/index.d.ts` and the re-exported
  `@zitadel/sdk-core/types` — the real prop names, component props
  (`ZitadelLoginProps`, `ZitadelLogoutProps`, `ZitadelSessionProps`), and
  `configureZitadel`'s config shape. Read the types before wiring a prop you
  are unsure of rather than assuming its name.

Exported surface (discover-first, confirm against the types above):
`configureZitadel`, `getApi`, `getZitadelConfig`, the `ZitadelLogin` /
`ZitadelLogout` / `ZitadelSession` components, `businessLocales`, and the
`ZitadelConfig` / `ZitadelProject` types.

## Gotchas

- **Production SPA deployment is not yet supported.** The same-origin proxy
  path must come from your hosting platform, and the CLI can't scaffold those
  configs yet, so a production SPA build has no proxy to talk to. See
  ADR 036 and zitadel/nextgen#560. The CLI dev proxy covers local
  development only.
- **TypeScript < 5.0 won't type-check.** The published `.d.ts` re-exports
  with `export type *`, introduced in TS 5.0.
- **`solid-js` is a peer dependency** (`>= 1.6`) — install it in the host
  app; the package does not bundle it.
