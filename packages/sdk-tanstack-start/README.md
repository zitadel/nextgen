# @zitadel/sdk-tanstack-start

TanStack Start request middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-tanstack-start
```

## Setup

### 1. Request middleware

Register a global request middleware in `src/start.ts` — the file TanStack Start
auto-loads as its server entry. It must export a `startInstance` from
`createStart`; wire the auth middleware via `requestMiddleware`:

```ts
import { createMiddleware, createStart } from '@tanstack/react-start';
import { createNextgenRequestMiddleware } from '@zitadel/sdk-tanstack-start/server';

const authMiddleware = createMiddleware({ type: 'request' }).server(
  createNextgenRequestMiddleware({
    url: process.env.ZITADEL_URL,
    projectSecret: process.env.ZITADEL_PROJECT_SECRET,
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [authMiddleware],
}));
```

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend, attaching the
   project service-key as the bearer (the secret never reaches the browser).
2. **Verifies** the session JWT via JWKS using the Web Crypto API and places the
   result on the router context as `nextgenAuth`.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes.

The proxy/verify/protect decision is also exported as the framework-agnostic
`handleNextgenRequest(request, options)` if you prefer to wire it into a custom
server entry.

### 2. Reading auth in a server function or `beforeLoad`

```ts
import { getAuth } from '@zitadel/sdk-tanstack-start/server';

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    const auth = getAuth(context);
    if (!auth.isAuthenticated) throw redirect({ to: '/login' });
    return { userId: auth.session.userId };
  },
});
```

### 3. Render the login widget

Use the typed React wrappers from the `/react` entry:

```tsx
import { ZitadelLogin } from '@zitadel/sdk-tanstack-start/react';
import { configureZitadel } from '@zitadel/sdk-tanstack-start/client';

configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export function LoginPage() {
  return <ZitadelLogin projectId="demo" proxyPath="/__nextgen" postSignInUrl="/admin" />;
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
