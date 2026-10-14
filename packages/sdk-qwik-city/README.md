# @zitadel/sdk-qwik-city

Qwik City request handler and helpers for Nextgen Auth.

> **Qwik 2 required.** This SDK peers Qwik 2 — `@qwik.dev/core` and
> `@qwik.dev/router` (Qwik City's package was renamed from `@builder.io/qwik-city`
> in Qwik 2), which run on Vite 8. A Qwik 1 app (`@builder.io/qwik`) is not
> supported: the login widget comes from `@zitadel/sdk-qwik`, which requires
> Qwik 2. Migrate the app to `@qwik.dev/*` first.

## Installation

```bash
pnpm add @zitadel/sdk-qwik-city
```

## Setup

### 1. Request handler

Add a root plugin, e.g. `src/routes/plugin@nextgen.ts`:

```ts
import { createNextgenOnRequest } from '@zitadel/sdk-qwik-city/server';

export const onRequest = createNextgenOnRequest({
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

`url` and `projectSecret` default to `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`,
read per request from Qwik City's `requestEvent.env` — which is where Vite loads
`.env` / `.env.local`, not `process.env` — falling back to `process.env`. Pass
them explicitly only to override that.

The handler runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend, attaching the
   project service-key as the bearer (the secret never reaches the browser).
2. **Verifies** the session JWT via JWKS using the Web Crypto API and stores the
   result on `requestEvent.sharedMap`.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes.

To run alongside your own `onRequest`, export an array — Qwik City runs them in
order:

```ts
export const onRequest = [createNextgenOnRequest({ /* … */ }), myOnRequest];
```

### 2. Reading auth in a loader, action, or endpoint

```ts
import { routeLoader$ } from '@qwik.dev/router';
import { getAuth } from '@zitadel/sdk-qwik-city/server';

export const useUser = routeLoader$((ev) => {
  const auth = getAuth(ev);
  if (!auth.isAuthenticated) throw ev.redirect(302, '/login');
  return { userId: auth.session.userId };
});
```

### 3. Render the login widget

Install the Qwik component library and render its `ZitadelLogin` component.
`@zitadel/sdk-qwik-city` is server-only; the widget comes from `@zitadel/sdk-qwik`.
Qwik bundles ecosystem packages, so install it as a dev dependency:

```bash
pnpm add -D @zitadel/sdk-qwik
```

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export default component$(() => {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
});
```

## Handler options

| Option              | Type                 | Default                      | Description                                                          |
| ------------------- | -------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `url`               | `string`             | `ZITADEL_URL` env            | Full URL of the Zitadel auth backend                                 |
| `projectSecret`     | `string`             | `ZITADEL_PROJECT_SECRET` env | Project service-key sent as the bearer on proxied requests           |
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
