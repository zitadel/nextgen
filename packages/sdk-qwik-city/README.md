# @zitadel/sdk-qwik-city

Qwik City request handler and helpers for Nextgen Auth.

> **Vite version note.** Qwik 1.x peers Vite `>=5 <8` (its optimizer relies on
> Rollup's `ModuleInfo`, which Vite 8's Rolldown bundler does not yet expose), so
> a Qwik City **app** runs on Vite 7. This SDK itself is bundler-agnostic — it
> ships plain TypeScript and adds no Vite constraint of its own.

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
  url: process.env.ZITADEL_URL,
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

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
import { routeLoader$ } from '@builder.io/qwik-city';
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
import { component$ } from '@builder.io/qwik';
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
