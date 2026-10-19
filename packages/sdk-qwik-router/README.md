# @zitadel/sdk-qwik-router

Qwik Router request handler and helpers for Zitadel.

> **Qwik 2 required.** This SDK peers Qwik 2 — `@qwik.dev/core` and
> `@qwik.dev/router` (Qwik Router, which Qwik 2 renamed from Qwik City,
> `@builder.io/qwik-city`), which run on Vite 8. A Qwik 1 app (`@builder.io/qwik`) is not
> supported: the login widget comes from `@zitadel/sdk-qwik`, which requires
> Qwik 2. Migrate the app to `@qwik.dev/*` first.

## Installation

```bash
pnpm add -D @zitadel/sdk-qwik-router@alpha
```

Install it as a dev dependency: Qwik bundles `devDependencies` into the server
build and leaves `dependencies` external, and ecosystem packages belong in the
bundle. Qwik's starter `vite.config.ts` also throws if a package is listed in
both sections.

## Requirements

Peer dependencies: `@qwik.dev/core` and `@qwik.dev/router`, both `^2.0.0-beta.45`.

TypeScript ≥ 5.0, the floor shared by every SDK; see the [compatibility notes](https://github.com/zitadel/nextgen/blob/main/packages/AGENTS.md).

## Setup

### 1. Request handler

Add a root plugin, e.g. `src/routes/plugin@nextgen.ts`:

```ts
import { createNextgenOnRequest } from '@zitadel/sdk-qwik-router/server';

export const onRequest = createNextgenOnRequest({
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

`url` and `projectSecret` default to `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`,
read per request from Qwik Router's `requestEvent.env` — which is where Vite loads
`.env` / `.env.local`, not `process.env` — falling back to `process.env`. Pass
them explicitly only to override that.

The handler runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend. The project secret
   is attached as the bearer only on the `POST /sessions/exchange` handoff, and
   never reaches the browser.
2. **Verifies** the session JWT via JWKS using the Web Crypto API and stores the
   result on `requestEvent.sharedMap`.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes, with the requested path and query string in `?next=`, where `<zitadel-login>` returns after sign-in.

To run alongside your own `onRequest`, export an array — Qwik Router runs them in
order:

```ts
export const onRequest = [createNextgenOnRequest({ /* … */ }), myOnRequest];
```

### 2. Reading auth in a loader, action, or endpoint

```ts
import { routeLoader$ } from '@qwik.dev/router';
import { getAuth } from '@zitadel/sdk-qwik-router/server';

export const useUser = routeLoader$((ev) => {
  const auth = getAuth(ev);
  if (!auth.isAuthenticated) throw ev.redirect(302, '/login');
  return { userId: auth.session.userId };
});
```

`protectedRoutes` guards full page loads (a direct visit or a reload): the
handler redirects before anything renders. Do not rely on it for client-side
`<Link>` navigation, which does not load the page from the server. There the
`ZitadelSession` card is the guard: when it finds no session it navigates to its
`postSignOutUrl`, so a signed-out visitor still ends at `/login`.

To keep a route from rendering at all without a session, export a loader like
the one above from the route itself. Qwik Router runs a route's `routeLoader$` on
the server for a `<Link>` navigation too, so its redirect sends the visitor to
`/login` before the route renders:

```tsx
// src/routes/profile/index.tsx
import { component$ } from '@qwik.dev/core';
import { routeLoader$ } from '@qwik.dev/router';
import { getAuth } from '@zitadel/sdk-qwik-router/server';

export const useSession = routeLoader$((ev) => {
  const auth = getAuth(ev);
  if (!auth.isAuthenticated) throw ev.redirect(302, '/login');
  return { userId: auth.session.userId };
});

export default component$(() => {
  const session = useSession();
  return <p>Signed in as {session.value.userId}</p>;
});
```

### 3. Render the login widget

Install the Qwik component library and render its `ZitadelLogin` component.
`@zitadel/sdk-qwik-router` is server-only; the widget comes from `@zitadel/sdk-qwik`.
Qwik bundles ecosystem packages, so install it as a dev dependency:

```bash
pnpm add -D @zitadel/sdk-qwik@alpha
```

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export default component$(() => {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
});
```

`ZitadelSession` renders the signed-in "signed in as" card with a sign-out
button, and `ZitadelLogout` a sign-out control on its own:

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelSession, configureZitadel } from '@zitadel/sdk-qwik';

const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export default component$(() => {
  return <ZitadelSession project={project} postSignOutUrl="/login" />;
});
```

The widgets' events surface as optional QRL callbacks: `onFlowStep$`,
`onFlowInput$`, `onFlowComplete$`, `onFlowRedirect$` and `onFlowError$` on
`ZitadelLogin`, and `onSignout$` on `ZitadelLogout` and `ZitadelSession`. Pass
`locales={businessLocales}` (exported from `@zitadel/sdk-qwik`) to show
work-email copy for a business audience.

## Handler options

| Option              | Type                 | Default                      | Description                                                          |
| ------------------- | -------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `url`               | `string`             | `ZITADEL_URL` env            | Full URL of the Zitadel auth backend                                 |
| `projectSecret`     | `string`             | `ZITADEL_PROJECT_SECRET` env | Project secret, sent as the bearer on the handoff exchange only           |
| `proxyPath`         | `string`             | `"/__nextgen"`               | Path prefix proxied to the auth backend                              |
| `protectedRoutes`   | `string[]`           | `[]`                         | Paths requiring a valid session. Trailing `*` matches sub-paths      |
| `ignoredRoutes`     | `string[]`           | `[]`                         | Paths skipped entirely — no JWT check. Trailing `*` matches sub-paths |
| `loginPath`         | `string`             | `"/login"`                   | Where to redirect unauthenticated users                              |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]`         | JWT `alg` values to accept                                           |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`          | Accepted `typ` header values (case-insensitive)                     |
| `clockSkewMs`       | `number`             | `5000`                       | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                  |
| `jwksTimeoutMs`     | `number`             | `5000`                       | Timeout in ms for JWKS endpoint requests                            |
| `proxyTimeoutMs`    | `number`             | `5000`                       | Timeout in ms for upstream proxy requests                           |
| `audience`          | `string \| string[]` | not validated                | Expected `aud` claim value(s)                                       |
