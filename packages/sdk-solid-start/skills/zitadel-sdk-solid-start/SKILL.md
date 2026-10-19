---
name: zitadel-sdk-solid-start
description: >-
  Integrate Zitadel authentication into an existing or custom SolidStart app
  with @zitadel/sdk-solid-start. Use when the user wants login, logout, session
  handling, or protected routes in a SolidStart 2 app and is wiring the SDK by
  hand rather than letting the CLI scaffold a fresh project — registering the
  middleware, reading auth state in a server function, or rendering the
  `ZitadelLogin` / `ZitadelSession` widgets.
---

# @zitadel/sdk-solid-start

SolidStart middleware and helpers that add Zitadel (Nextgen) auth to a
SolidStart app. The middleware proxies auth traffic same-origin under
`/__nextgen`, verifies the session JWT via JWKS on the server, writes the result
to `event.locals.nextgenAuth`, and redirects unauthenticated requests on
protected routes. The package is server-only; the widgets come from
`@zitadel/sdk-solid`.

## When to use

The `zitadel` CLI (`zitadel setup --framework solid-start`) scaffolds the
middleware, its `vite.config.ts` registration, login/register/profile routes,
and `.env.local` into a fresh or detected SolidStart project — prefer it for
greenfield work. It refuses a SolidStart 1 app. Reach for **this skill** when you
are adding auth to an **existing or custom** SolidStart app by hand, or
adjusting a scaffolded wiring.

## Install

```bash
pnpm add @zitadel/sdk-solid-start@alpha
# the login/logout/session widgets are a separate package:
pnpm add @zitadel/sdk-solid@alpha
```

Peer deps: `@solidjs/start ^2.0.0`, `solid-js ^1.8.0`.

## Integrate

**1. Middleware.** Create `src/middleware.ts`, wrapped in SolidStart's
`createMiddleware`, and register it with the `solidStart()` Vite plugin:

```ts
// src/middleware.ts
import { createMiddleware } from '@solidjs/start/middleware';
import { createNextgenMiddleware } from '@zitadel/sdk-solid-start/server';

export default createMiddleware(
  createNextgenMiddleware({
    protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
    loginPath: '/login',
  }),
);
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { solidStart } from '@solidjs/start/config';
import { nitro } from 'nitro/vite';

export default defineConfig({
  plugins: [solidStart({ middleware: './src/middleware.ts' }), nitro()],
});
```

`url` and `projectSecret` default to `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`
from the server environment; pass them only to override. To compose with your own
handlers, spread the config's `onRequest` into your own `createMiddleware` call.

**2. Read auth server-side** with `getAuth(getRequestEvent()!)` inside a
`'use server'` function:

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

`protectedRoutes` only guards full page loads. To keep a route from rendering at
all without a session, check the session in a `query` that `throw redirect('/login')`
and call it from the route's `preload` — it runs on the server for client-side
navigation too.

**3. Render the widgets** from `@zitadel/sdk-solid`, loaded with SolidStart's
`clientOnly` so they are created in the browser and the package stays out of the
server render:

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

`ZitadelSession` (with `postSignOutUrl="/login"`) and `ZitadelLogout` load the
same way.

## Widget props and events

This SDK is server-only. The widgets come from `@zitadel/sdk-solid`, so read its skill for the widget props and events.

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-solid-start/README.md` and the
bundled `.d.ts` types (`dist/server.d.ts`, `dist/client.d.ts`) are authoritative
and versioned with the installed package — read them before wiring anything, and
let them override anything remembered. This skill teaches the pattern, not a
full catalog of options or the shared JWT-verification pipeline (that lives in
`@zitadel/sdk-core`). For widget props and callbacks, read
`node_modules/@zitadel/sdk-solid/README.md` and its types. Check exact option
names and defaults against the installed version rather than assuming.

## Gotchas

- **Wrap the config in `createMiddleware`.** SolidStart 2 registers the default
  export as an array of h3 middleware; exporting the bare
  `createNextgenMiddleware(...)` object registers nothing and `/__nextgen/*`
  404s.
- **Pass `projectId` / `proxyPath` as props, not a `configureZitadel` handle.**
  Building the handle imports `@zitadel/sdk-solid` at module scope, outside the
  `clientOnly` boundary.
- **`@zitadel/sdk-solid-start` renders no widgets.** They come from
  `@zitadel/sdk-solid`, which registers custom elements on import — never import
  it at module scope in a server-rendered file.
- **Client-side navigation skips the middleware.** Without a preloaded server
  query, only the `ZitadelSession` card sends a signed-out visitor away.
