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
import { createMiddleware } from '@solidjs/start/middleware';
import { createNextgenMiddleware } from '@zitadel/sdk-solid-start/server';

export default createMiddleware(
  createNextgenMiddleware({
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  }),
);
```

`url` and `projectSecret` default to `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`
from the server environment (Nitro loads `.env` / `.env.local` in dev); pass
them only to override.

SolidStart 2 registers this module's default export as an array of h3
middleware, so the config must be wrapped in SolidStart's `createMiddleware`.
Exporting the bare `createNextgenMiddleware(...)` object registers nothing and
`/__nextgen/*` 404s.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { solidStart } from '@solidjs/start/config';
import { nitro } from 'nitro/vite';

export default defineConfig({
  plugins: [solidStart({ middleware: './src/middleware.ts' }), nitro()],
});
```

> SolidStart 1 instead read `middleware` from a top-level `app.config.ts` field
> (`defineConfig({ middleware })`). On SolidStart 1, set it there.

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend. The project secret
   is attached as the bearer only on the `POST /sessions/exchange` handoff, and
   never reaches the browser.
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

Load it with SolidStart's `clientOnly`. The widget registers custom elements
(`customElements.define`) when its module is imported, which throws during
SSR — a top-level `import … from '@zitadel/sdk-solid'` in a route crashes the
server render and the page comes back empty. `clientOnly` defers the import to
the browser:

```tsx
import { clientOnly } from '@solidjs/start';

const ZitadelLogin = clientOnly(() =>
  import('@zitadel/sdk-solid').then((m) => ({ default: m.ZitadelLogin })),
);

export default function Login() {
  return (
    <ZitadelLogin
      projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID}
      proxyPath="/__nextgen"
      purpose="login"
      postSignInUrl="/admin"
    />
  );
}
```

Pass `projectId` / `proxyPath` as props rather than a `configureZitadel`
handle: building the handle means importing `@zitadel/sdk-solid` at module
scope, which brings the SSR crash back.

## Middleware options

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
