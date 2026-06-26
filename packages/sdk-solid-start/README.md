# @zitadel/sdk-solid-start

SolidStart middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-solid-start
```

## Setup

### 1. Middleware

Create `src/middleware.ts` and register it via the `solidStart()` plugin in
`vite.config.ts`:

```ts
// src/middleware.ts
import { createNextgenMiddleware } from '@zitadel/sdk-solid-start/server';

export default createNextgenMiddleware({
  url: process.env.ZITADEL_URL,
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { solidStart } from '@solidjs/start/config';

export default defineConfig({
  plugins: [solidStart({ middleware: './src/middleware.ts' })],
});
```

> SolidStart 1 instead read `middleware` from a top-level `app.config.ts` field
> (`defineConfig({ middleware })`). On SolidStart 1, set it there.

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend, attaching the
   project service-key as the bearer (the secret never reaches the browser).
2. **Verifies** the session JWT via JWKS using the Web Crypto API and writes the
   result to `event.locals.nextgenAuth`.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes.

To compose with your own handlers, spread the config's `onRequest`:

```ts
import { createMiddleware } from '@solidjs/start/middleware';
import { createNextgenMiddleware } from '@zitadel/sdk-solid-start/server';

export default createMiddleware({
  onRequest: [...createNextgenMiddleware({ /* … */ }).onRequest, myOnRequest],
});
```

### 2. Reading auth in a server function or route

```ts
import { getRequestEvent } from 'solid-js/web';
import { getAuth } from '@zitadel/sdk-solid-start/server';

export function requireUser() {
  'use server';
  const auth = getAuth(getRequestEvent()!);
  if (!auth.isAuthenticated) throw new Error('Unauthorized');
  return auth.session.userId;
}
```

### 3. Render the login widget

Install the Solid component library and render its `ZitadelLogin` component.
`@zitadel/sdk-solid-start` is server-only; the widget comes from `@zitadel/sdk-solid`:

```bash
pnpm add @zitadel/sdk-solid
```

```tsx
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-solid';

const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export default function Login() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
}
```

## Middleware options

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
