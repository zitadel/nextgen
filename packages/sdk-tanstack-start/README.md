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
`createStart`; wire the auth middleware via `requestMiddleware`. Having this
file opts the app out of TanStack Start's automatic CSRF protection for server
functions, so restore it with `createCsrfMiddleware` and list it before auth:

```ts
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';
import { createNextgenRequestMiddleware } from '@zitadel/sdk-tanstack-start/server';

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

const authMiddleware = createMiddleware({ type: 'request' }).server(
  createNextgenRequestMiddleware({
    url: process.env.ZITADEL_URL,
    projectSecret: process.env.ZITADEL_PROJECT_SECRET,
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authMiddleware],
}));
```

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend. The project secret
   is attached as the bearer only on the `POST /sessions/exchange` handoff, and
   never reaches the browser.
2. **Verifies** the session JWT via JWKS using the Web Crypto API and places the
   result on the request context as `nextgenAuth`, which server functions
   receive.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes.

The proxy/verify/protect decision is also exported as the framework-agnostic
`handleNextgenRequest(request, options)` if you prefer to wire it into a custom
server entry.

### 2. Reading auth in a server function, and guarding a route

Server functions receive the request middleware's context, so read auth there
with `getAuth(context)`. A route's own `beforeLoad` context does **not** carry
it — and on client-side navigation `beforeLoad` runs in the browser, where no
request middleware ran at all. Guard a route by calling a server function from
`beforeLoad`; the call goes to the server on every navigation:

```ts
import { createServerFn } from '@tanstack/react-start';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuth } from '@zitadel/sdk-tanstack-start/server';

const fetchAuth = createServerFn().handler(({ context }) => getAuth(context));

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const auth = await fetchAuth();
    if (!auth.isAuthenticated) throw redirect({ to: '/login' });
    return { userId: auth.session.userId };
  },
});
```

`protectedRoutes` alone only guards full document requests (a hard load or
reload), not client-side `<Link>` navigation. Without a `beforeLoad` guard, the
`ZitadelSession` card is the guard on client-side navigation: when it finds no
session it navigates to its `postSignOutUrl`, so a signed-out visitor still ends
at `/login`. The `beforeLoad` guard above keeps the route from rendering at all.

### 3. Render the login widget

Use the typed React wrappers from the `/react` entry. They are
`@zitadel/sdk-react`'s components, rendered on the client only: on the server and
during hydration they render nothing, and right after hydration they mount the
widget with every prop in place, so it never starts a flow with its defaults.
The `/client` entry only configures the SDK; it exports no components.

```tsx
import { ZitadelLogin } from '@zitadel/sdk-tanstack-start/react';
import { configureZitadel } from '@zitadel/sdk-tanstack-start/client';

const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
}
```

`ZitadelSession` renders the signed-in "signed in as" card with a sign-out
button, and `ZitadelLogout` a sign-out control on its own:

```tsx
import { ZitadelSession } from '@zitadel/sdk-tanstack-start/react';

export function ProfilePage() {
  return <ZitadelSession project={project} postSignOutUrl="/login" />;
}
```

The widgets' events surface as optional callbacks: `onFlowStep`, `onFlowInput`,
`onFlowComplete`, `onFlowRedirect` and `onFlowError` on `ZitadelLogin`, and
`onSignout` and `onSessionMissing` (no session when the widget loads) on
`ZitadelLogout` and `ZitadelSession`. Pass
`locales={businessLocales}` (also exported from `/react`) to show work-email copy
for a business audience.

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
