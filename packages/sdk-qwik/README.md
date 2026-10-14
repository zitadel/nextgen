# @zitadel/sdk-qwik

Qwik components for the Zitadel auth UI. They work in a client-side Qwik app and under Qwik City
SSR (pair them with [`@zitadel/sdk-qwik-city`](https://github.com/zitadel/nextgen/tree/main/packages/sdk-qwik-city) for the server side).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

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

`<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.

The signed-in session card is `<ZitadelSession project={project} />` (exported as `ZitadelSession`).

The widget's events are surfaced as optional QRL callbacks:

| Component | Callbacks |
| --- | --- |
| `ZitadelLogin` | `onFlowStep$`, `onFlowInput$`, `onFlowComplete$`, `onFlowRedirect$`, `onFlowError$` |
| `ZitadelLogout`, `ZitadelSession` | `onSignout$` |

The SDK loads each callback's code before it starts listening, so a callback runs before the widget
navigates away (after a sign-out, a redirect, or a completed flow with a redirect).

Children are passed through to the element, so `<ZitadelLogout>` accepts a `<template>` for its
template mode and `<ZitadelLogin>` accepts content for its `attribution-trailing` slot.

### How props reach the element

Qwik binds JSX props on a custom element as attributes only, so the SDK uses both channels:

- **Attributes**, rendered in the JSX (and so in the server HTML under Qwik City):
  `project-id`, `proxy-path` and `url` (taken from `project` or from the discrete props),
  `purpose`, `flow-name`, `post-sign-in-url`, `post-sign-out-url`, `variant`, `theme`, `heading`,
  `logout-label`, `suppress-header` and `lang`. The widget reads these as soon as it upgrades,
  before Qwik resumes.
- **Properties**, set on the element by the component once it is mounted (or resumed): every
  config prop again, plus the property-only `project` handle and `locales`.

A prop you remove or set to `undefined` is cleared on the element, which falls back to its
default (for example the session card's "Signed in as" heading).

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
