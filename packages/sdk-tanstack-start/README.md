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
`beforeLoad`; the call goes to the server on every navigation.

`getAuth(context)` carries the raw session token (`session.token`), which
Zitadel sets as an HttpOnly cookie so no script can read it. Use it on the
server only, and never return it from a server function: TanStack sends the
return value to the browser. Return `getClientAuth(context)` instead, the same
state without the token:

```ts
import { createServerFn } from '@tanstack/react-start';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { getClientAuth } from '@zitadel/sdk-tanstack-start/server';

const fetchAuth = createServerFn().handler(({ context }) => getClientAuth(context));

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const auth = await fetchAuth();
    if (!auth.isAuthenticated) {
      // Zitadel could not be asked: an outage, not a sign-out.
      if (auth.reason === 'unavailable') throw new Error('Try again shortly');
      throw redirect({ to: '/login' });
    }
    return { userId: auth.session.userId };
  },
});
```

`protectedRoutes` alone only guards full document requests (a hard load or
reload), not client-side `<Link>` navigation. Without a `beforeLoad` guard, the
`ZitadelSession` card is the guard on client-side navigation: when it finds no
session it navigates to its `postSignOutUrl`, so a signed-out visitor still ends
at `/login`. When that URL is the page the card is on, the card renders nothing
instead of navigating, so it guards nothing there. The `beforeLoad` guard above keeps the route from rendering at all.

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
`onSignout`, `onSessionMissing` (no session when the widget loads) and
`onSessionError` (loading the session or signing out failed some other way) on
`ZitadelLogout` and `ZitadelSession`. Pass
`locales={businessLocales}` (also exported from `/react`) to show work-email copy
for a business audience.

`/react` also exports every type `@zitadel/sdk-react` does, so a callback can be
typed without installing `@zitadel/sdk-react`:

```tsx
import type { ZitadelFlowCompleteDetail } from '@zitadel/sdk-tanstack-start/react';

const onFlowComplete = (detail: ZitadelFlowCompleteDetail) => console.log(detail.redirect_uri);
```

## Middleware options

| Option              | Type                 | Default                      | Description                                                          |
| ------------------- | -------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `url`               | `string`             | `ZITADEL_URL` env            | Full URL of the Zitadel auth backend                                 |
| `projectSecret`     | `string`             | `ZITADEL_PROJECT_SECRET` env | Project secret, sent as the bearer on the handoff exchange only           |
| `proxyPath`         | `string`             | `"/__nextgen"`               | Path prefix proxied to the auth backend                              |
| `protectedRoutes`   | `string[]`           | `[]`                         | Paths requiring a valid session. Trailing `*` matches sub-paths      |
| `ignoredRoutes`     | `string[]`           | `[]`                         | Paths skipped entirely — no JWT check. Trailing `*` matches sub-paths |
| `loginPath`         | `string`             | `"/login"`                   | Where to redirect unauthenticated users. Setup fails if `protectedRoutes` matches it and `ignoredRoutes` does not                              |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]`         | JWT `alg` values to accept                                           |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`          | Accepted `typ` header values (case-insensitive)                     |
| `clockSkewMs`       | `number`             | `5000`                       | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                  |
| `jwksTimeoutMs`     | `number`             | `5000`                       | Timeout in ms for JWKS endpoint requests                            |
| `proxyTimeoutMs`    | `number`             | `5000`                       | Timeout in ms for upstream proxy requests. A request exceeding it is answered `504`; an unreachable backend `502`, both with a `{ code, message }` body |
| `audience`          | `string \| string[]` | not validated                | Expected `aud` claim value(s)                                       |

Only Zitadel's own answer that the session is gone, a `401` with the code `auth.unauthorized` or a `404` with `sess.not_found`, clears the session cookie. If the Zitadel server times out, is unreachable, answers `5xx`, or something in front of it (a gateway, a wrong `url`) answers a `401`/`404` page of its own, the cookie is kept: public pages render signed out with `getAuth()` reporting `reason: "unavailable"`, and a protected route is answered `503` with `retry-after`. Guard your own loaders the same way (see above). When Zitadel cannot be reached (a network error, a timeout, or a `502`, `503` or `504`), the SDK logs it once and does not ask again for 15 seconds, and while one check has gone a second without an answer, other requests do not wait for it, so a hanging server does not slow every request. Any other failure holds for that request only. A session cookie that cannot be a Zitadel token (characters a token never has, or far too long) is treated as signed out without asking Zitadel. `handleNextgenRequest` reports that case as `{ type: "unavailable" }`.
