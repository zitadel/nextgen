---
name: zitadel-sdk-qwik
description: >-
  Integrate Zitadel authentication into a Qwik app with `@zitadel/sdk-qwik`.
  Use when the user wants to add login, logout, or a signed-in session card to
  an existing or custom client-side Qwik SPA — wiring the `ZitadelLogin`,
  `ZitadelLogout`, or `ZitadelSession` components and `configureZitadel`.
---

# @zitadel/sdk-qwik

Qwik components that wrap the Zitadel auth UI web components (`<zitadel-login>`,
`<zitadel-logout>`, `<zitadel-session>`) for client-side SPAs (Vite, etc.). The
package exports the components, the `configureZitadel` handle factory, and the
shared SPA config/handler types.

## When to use

- **Fresh Qwik app → use the CLI instead.** `zitadel setup --framework qwik`
  scaffolds auth into a new or detected Qwik project end to end (it wires this
  SDK, the dev proxy, and config). Reach for the `zitadel-cli` skill for that.
  Note the CLI scaffolds against **Qwik 2**, which this package also targets.
- **This skill is for an existing or custom Qwik app** where you are adding the
  components by hand — or adjusting a wiring the CLI already produced.

## Install

```sh
pnpm add @zitadel/sdk-qwik
```

The package declares a peer dependency on `@qwik.dev/core` (`^2.0.0-beta.45`),
so the host app must be on **Qwik 2**. TypeScript ≥ 5.0 is required — the
published types re-export with `export type *`, a 5.0 feature.

## Integrate

Build a project handle with `configureZitadel`, then render a component with it:

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

export default component$(() => {
  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });

  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
});
```

- `<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.
- `<ZitadelSession project={project} />` renders the signed-in session card.
- Instead of the `project` handle you may pass the discrete `projectId` /
  `proxyPath` props; the widget uses whichever is present.
- Flow events are surfaced as optional QRL callbacks on the components:
  `onFlowStep$`, `onFlowInput$`, `onFlowComplete$`, `onFlowError$`.
- The SDK binds `project` (and `projectId` / `proxyPath`) to the element as DOM
  *properties*, matching the other framework SDKs.

## Read these, don't guess

Confirm the current surface before wiring — do not rely on memory:

- `node_modules/@zitadel/sdk-qwik/README.md` — the installed package's own usage
  notes (proxying, deployment status) are authoritative over this skill.
- The package's `.d.ts` types (`node_modules/@zitadel/sdk-qwik/dist/index.d.ts`)
  are the source of truth for exports and prop names. The named exports are
  `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `configureZitadel`,
  `getApi`, `getZitadelConfig`, and `businessLocales`; prop types
  (`ZitadelLoginProps`, etc.) and the shared SPA config/handler types are
  re-exported there. Check props (`purpose`, `variant`, `theme`, `flowName`,
  `locales`, `lang`, `ref`, …) against the types rather than assuming them.

## Gotchas

- **Qwik 2 only.** The peer dep is `@qwik.dev/core ^2.0.0-beta.45` and imports
  come from `@qwik.dev/core` (not `@builder.io/qwik`). A Qwik 1 app will not
  satisfy the peer range.
- **Proxying is same-origin.** The widgets call `${proxyPath}/…` same-origin
  (default `/__nextgen`). The CLI dev proxy covers local development. Per the
  README, **production SPA deployment is not yet supported** — the same-origin
  path must come from your hosting platform, and the CLI cannot scaffold those
  configs yet.
- **Local dev without the proxy.** You can point `proxyPath` straight at the
  backend cross-origin, e.g. `proxyPath: 'http://localhost:8080'` (the
  `zitadel start` local runtime default port).
- **Properties, not attributes.** Config is applied imperatively as DOM
  properties because Qwik 2 binds custom-element JSX props as lower-cased
  attributes only — which is why the SDK wrapper exists rather than using the
  web components directly.
