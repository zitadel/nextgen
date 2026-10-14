# @zitadel/sdk-solid-start

SolidStart middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-solid-start@alpha
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

`protectedRoutes` guards full page loads (a direct visit or a reload): the
middleware redirects before anything renders. Client-side navigation, such as
following an `<A>` link to `/profile`, does not request the page from the
server, so the middleware does not run. There the `ZitadelSession` card is the
guard: when it finds no session it navigates to its `postSignOutUrl`, so a
signed-out visitor still ends at `/login`.

To keep a route from rendering at all without a session, check the session in a
server query and preload it. The query runs on the server on client-side
navigation too, and its `redirect` sends the visitor to `/login` before the
route renders:

```tsx
// src/routes/profile.tsx
import { createAsync, query, redirect, type RouteDefinition } from '@solidjs/router';
import { getRequestEvent } from 'solid-js/web';
import { getAuth } from '@zitadel/sdk-solid-start/server';

const requireSession = query(async () => {
  'use server';
  const auth = getAuth(getRequestEvent()!);
  if (!auth.isAuthenticated) throw redirect('/login');
  return auth.session.userId;
}, 'session');

export const route = {
  preload: () => requireSession(),
} satisfies RouteDefinition;

export default function Profile() {
  const userId = createAsync(() => requireSession(), { deferStream: true });
  return <p>Signed in as {userId()}</p>;
}
```

### 3. Render the login widget

Install the Solid component library and render its `ZitadelLogin` component.
`@zitadel/sdk-solid-start` is server-only; the widget comes from `@zitadel/sdk-solid`:

```bash
pnpm add @zitadel/sdk-solid@alpha
```

Load it with SolidStart's `clientOnly`, so the widget is created in the browser
with its config in place: its config is set as element properties, which
server-rendered markup cannot carry. `clientOnly` also keeps
`@zitadel/sdk-solid`, which registers the custom elements when its module is
imported, out of the server render:

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
scope, outside the client-only boundary.

`ZitadelSession` renders the signed-in "signed in as" card with a sign-out
button, and `ZitadelLogout` a sign-out control on its own. Load them the same
way:

```tsx
const ZitadelSession = clientOnly(() =>
  import('@zitadel/sdk-solid').then((m) => ({ default: m.ZitadelSession })),
);

export default function Profile() {
  return (
    <ZitadelSession
      projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID}
      proxyPath="/__nextgen"
      postSignOutUrl="/login"
    />
  );
}
```

The widgets' events surface as optional callbacks: `onFlowStep`, `onFlowInput`,
`onFlowComplete`, `onFlowRedirect` and `onFlowError` on `ZitadelLogin`, and
`onSignout` on `ZitadelLogout` and `ZitadelSession`. To show work-email copy for
a business audience, pass `locales={businessLocales}`; both come from
`@zitadel/sdk-solid`, so wrap the widget inside the `clientOnly` loader:

```tsx
const ZitadelLogin = clientOnly(() =>
  import('@zitadel/sdk-solid').then(({ ZitadelLogin: Login, businessLocales }) => ({
    default: (props: ComponentProps<typeof Login>) => (
      <Login {...props} locales={businessLocales} />
    ),
  })),
);
```

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
