# @zitadel/sdk-next

Next.js middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-next
```

## Entry points

| Import                         | Runs in                          | Provides                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------ |
| `@zitadel/sdk-next/middleware` | Edge middleware                  | `nextgenMiddleware`, `createProxy`               |
| `@zitadel/sdk-next/server`     | Server Components, Route Handlers | `auth()`, `NextgenProvider`                      |
| `@zitadel/sdk-next/react`      | Client Components                | `useAuth()`, `AuthContextProvider`               |
| `@zitadel/sdk-next/session`    | Client Components                | `getSession()`                                   |
| `@zitadel/sdk-next/client`     | Client boundary                  | Web-component registration, `configureZitadel()` |

The package root re-exports the server and client surfaces together for use
in server modules. Do not import the root from a `"use client"` module: it
pulls in the server-only `auth()`, which fails the build with an import trace
(exactly how depends on the bundler's tree shaking — the supported client
imports are `/react` and `/session`). `NextgenProvider` is itself server-only
because it accepts the token-bearing `auth()` result — see section 3.

## Setup

### 1. Middleware

Create `src/proxy.ts` at the root of your Next.js app:

```ts
import { nextgenMiddleware } from '@zitadel/sdk-next/middleware';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL,
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  });
}

export const config = {
  matcher: ['/__nextgen/:path*', '/admin', '/login'],
};
```

The middleware runs on every matched route and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend
2. **Verifies** the session JWT via JWKS using the Web Crypto API
3. **Redirects** unauthenticated requests to `loginPath` for protected routes

### 2. Reading auth in a Server Component

```ts
import { auth } from "@zitadel/sdk-next/server";

export default async function Page() {
  const session = await auth();
  if (!session.isAuthenticated) return <p>Not signed in</p>;
  return <p>Hello {session.session.email}</p>;
}
```

`auth()` reads the token the middleware tunnelled into the request headers
and **verifies it before trusting it** — JWTs cryptographically via JWKS,
opaque tokens against the backend's `GET /sessions/me` (which also supplies
the user's identity). A forged `x-nextgen-auth-token` header sent directly by
a client to a route outside the middleware `matcher` is rejected. Two things
follow:

- `auth()` only reports a session on routes the `matcher` covers — on other
  routes the token never reaches it (see section 4 for chrome on public
  pages).
- If the middleware runs with custom verification options (`audience`,
  `allowedAlgorithms`, …), pass the same values to `auth()` so both layers
  accept the same tokens.

`session.token` is the raw session token, available server-side for calling
upstream APIs. Never forward it into client components yourself —
`NextgenProvider` strips it for you (next section).

### 3. Reading auth in a Client Component

Seed the client tree once in your root layout (a Server Component), then
read the state with `useAuth()` anywhere below it:

```tsx
import { auth, NextgenProvider } from '@zitadel/sdk-next/server';

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html>
      <body>
        <NextgenProvider session={session}>{children}</NextgenProvider>
      </body>
    </html>
  );
}
```

`NextgenProvider` converts the `auth()` result to the client-safe shape
**before** it crosses the server→client boundary: client components receive
`userId` / `email` / `name`, and the raw session token never enters the RSC
flight payload, where any script on the page could read it.

That strip only protects you while it runs on the server, which is why
`NextgenProvider` is server-only and **must not be re-exported through a
`"use client"` wrapper** (the common `providers.tsx` pattern): the wrapper
would become the client boundary, and its still-unstripped `session` prop —
token included — would serialise into the flight payload before the provider
ever ran. The `server-only` guard turns that wrapper into a build error
instead of a silent leak. To seed the context from client-side state (e.g. a
`getSession()` read), render `AuthContextProvider` from
`@zitadel/sdk-next/react` — it only accepts the token-less
`ClientAuthResult`.

Then in any client component:

```tsx
'use client';
import { useAuth } from '@zitadel/sdk-next/react';

export function UserBadge() {
  const auth = useAuth();
  return <span>{auth.isAuthenticated ? auth.session.email : 'Guest'}</span>;
}
```

`useAuth()` returns the same client-safe `ClientAuthResult` shape as
`getSession()` and sdk-nuxt's `useAuth()`. It reflects what the server knew
when the page rendered — which, like `auth()`, is only a live session on
routes the middleware `matcher` covers.

### 4. Session state for your own UI (any page)

`auth()` only sees a session on routes the middleware `matcher` covers, and the
scaffolded matcher covers just the proxy path and the protected routes — so a
header on a public page would always look signed out. For your app's own chrome
(header navigation, account menus), read the session client-side with
`getSession()` from `@zitadel/sdk-next/session`. It fetches the same-origin
`{proxyPath}/sessions/me` — the same read the `<zitadel-session>` card performs —
so it works on every page and the answer is the server's:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { getSession, type ClientAuthResult } from '@zitadel/sdk-next/session';

export function HeaderNav() {
  // undefined = not yet known — render neutral chrome, not "Sign in".
  const [auth, setAuth] = useState<ClientAuthResult>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    getSession().then(setAuth, setError);
  }, []);
  if (error) return <span role="alert">Session unavailable</span>;
  if (!auth) return null;
  return auth.isAuthenticated ? (
    <a href="/profile">{auth.session.name ?? auth.session.email ?? 'Account'}</a>
  ) : (
    <a href="/login">Sign in</a>
  );
}
```

A rejected `getSession()` means the state is *unknown* (broken proxy, network,
5xx) — render a neutral or error state, never the signed-out CTAs.

A `200` with a non-empty `user_id` resolves to
`{ isAuthenticated: true, session: { userId, email, name } }` (client-safe —
no token); the canonical `401/auth.unauthorized`,
`404/sess.not_found`, and anonymous sessions resolve to signed out. The request
and response are both marked no-store. Any other response — including malformed
JSON or a framework's HTML 404 page from a misrouted proxy — throws so a broken
proxy doesn't silently render as signed out. Sign-in and sign-out navigate
(`post-sign-in-url` / `post-sign-out-url`), so chrome re-reads on the next page
load without extra wiring; to react in place, listen for the widgets'
`zitadel-signout` / `zitadel-flow-complete` events.

### 5. Login page

The `<zitadel-login>` web component (from `@zitadel/components`) must be rendered client-side only. Split it into a server wrapper and a client widget:

```tsx
// app/login/page.tsx (server)
import { auth } from '@zitadel/sdk-next';
import { redirect } from 'next/navigation';
import { LoginWidget } from './widget';

export default async function LoginPage() {
  const session = await auth();
  if (session.isAuthenticated) redirect('/admin');
  return <LoginWidget />;
}
```

```tsx
// app/login/widget.tsx (client)
'use client';
import dynamic from 'next/dynamic';
import { configureZitadel } from '@zitadel/api/config';

const project = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID!,
  proxyPath: '/__nextgen',
});

const ZitadelLogin = dynamic(
  async () => {
    await import('@zitadel/components');
    return function ZitadelLoginElement() {
      return <zitadel-login post-sign-in-url="/admin" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <ZitadelLogin />;
}
```

There is no `api-base` attribute — the element reads the global handle from
`configureZitadel()` (or you can assign the returned handle to the element's
`project` property).

## Middleware options

| Option              | Type                 | Default                  | Description                                                                                                                |
| ------------------- | -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | `string`             | `ZITADEL_URL` env        | Full URL of the Zitadel auth backend                                                                                       |
| `proxyPath`         | `string`             | `"/__nextgen"`           | Path prefix proxied to the auth backend                                                                                    |
| `protectedRoutes`   | `string[]`           | `[]`                     | Paths requiring a valid session. Trailing `*` matches sub-paths                                                            |
| `ignoredRoutes`     | `string[]`           | `[]`                     | Paths skipped entirely — no JWT check, no tunnelling. Useful for webhooks or health checks. Trailing `*` matches sub-paths |
| `loginPath`         | `string`             | `"/login"`               | Where to redirect unauthenticated users                                                                                    |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]`     | JWT `alg` values to accept. Tokens with any other algorithm are rejected before JWKS is fetched                            |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`      | Accepted `typ` header values (case-insensitive). Set to `[]` to disable this check                                         |
| `clockSkewMs`       | `number`             | `5000`                   | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                                                                         |
| `jwksTimeoutMs`     | `number`             | `5000`                   | Timeout in ms for JWKS endpoint requests. Token is rejected if the fetch exceeds this window                               |
| `opaqueTokenTimeoutMs` | `number`          | `5000`                   | Timeout in ms for opaque (non-JWT) session validation via `GET /sessions/me`. Also accepted by `auth()`                    |
| `proxyTimeoutMs`    | `number`             | `5000`                   | Timeout in ms for upstream proxy requests; requests exceeding it abort with a network error                                |
| `jwtKey`            | `string`             | unset                    | Reserved for future use — local PEM public key for offline JWT verification                                                |
| `audience`          | `string \| string[]` | not validated            | Expected `aud` claim value(s). When omitted, audience is not checked                                                       |

## How JWT verification works

The verification pipeline is shared across SDKs and documented once in
[`@zitadel/sdk-core`](https://github.com/zitadel/nextgen/tree/main/packages/sdk-core#how-jwt-verification-works).
On top of that pipeline, the Next.js middleware adds:

1. The `x-nextgen-auth-token` header is stripped from all proxied requests to prevent internal state leakage
2. `auth()` re-applies the same verification to the tunnelled token in the server runtime — the header alone is never treated as proof of a session
