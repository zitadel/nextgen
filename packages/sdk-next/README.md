# @zitadel/sdk-next

Next.js middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-next@next
```

## Setup

### 1. Middleware

Create `src/proxy.ts` at the root of your Next.js app:

```ts
import { nextgenMiddleware } from '@zitadel/sdk-next/middleware';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL,
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
import { auth } from "@zitadel/sdk-next";

export default async function Page() {
  const session = await auth();
  if (!session.isAuthenticated) return <p>Not signed in</p>;
  return <p>Hello {session.session.email}</p>;
}
```

### 3. Reading auth in a Client Component

Wrap your app in `NextgenProvider` (e.g. in your root layout):

```tsx
import { NextgenProvider } from '@zitadel/sdk-next';

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html>
      <body>
        <NextgenProvider value={session}>{children}</NextgenProvider>
      </body>
    </html>
  );
}
```

Then in any client component:

```tsx
'use client';
import { useAuth } from '@zitadel/sdk-next';

export function UserBadge() {
  const auth = useAuth();
  return <span>{auth.isAuthenticated ? auth.session.email : 'Guest'}</span>;
}
```

### 4. Login page

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

const ZitadelLogin = dynamic(
  async () => {
    await import('@zitadel/components');
    return function ZitadelLoginElement() {
      return (
        <zitadel-login
          api-base="/__nextgen"
          project-id="demo"
          post-sign-in-url="/admin"
        />
      );
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <ZitadelLogin />;
}
```

## Middleware options

| Option              | Type                 | Default                  | Description                                                                                                                |
| ------------------- | -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `issuerUrl`         | `string`             | `NEXTGEN_ISSUER_URL` env | Full URL of the Nextgen auth backend                                                                                       |
| `proxyPath`         | `string`             | `"/__nextgen"`           | Path prefix proxied to the auth backend                                                                                    |
| `protectedRoutes`   | `string[]`           | `[]`                     | Paths requiring a valid session. Trailing `*` matches sub-paths                                                            |
| `ignoredRoutes`     | `string[]`           | `[]`                     | Paths skipped entirely — no JWT check, no tunnelling. Useful for webhooks or health checks. Trailing `*` matches sub-paths |
| `loginPath`         | `string`             | `"/login"`               | Where to redirect unauthenticated users                                                                                    |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]`     | JWT `alg` values to accept. Tokens with any other algorithm are rejected before JWKS is fetched                            |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`      | Accepted `typ` header values (case-insensitive). Set to `[]` to disable this check                                         |
| `clockSkewMs`       | `number`             | `5000`                   | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                                                                         |
| `jwksTimeoutMs`     | `number`             | `5000`                   | Timeout in ms for JWKS endpoint requests. Token is rejected if the fetch exceeds this window                               |
| `audience`          | `string \| string[]` | not validated            | Expected `aud` claim value(s). When omitted, audience is not checked                                                       |

## How JWT verification works

1. Bearer token from `Authorization` header is checked first; `__nextgen_session` cookie is the fallback
2. The JWT header is decoded to extract `kid` and `alg`
3. Tokens with an `alg` not in `allowedAlgorithms` (`RS256`, `ES256` by default) are rejected immediately — no JWKS fetch
4. Tokens with a `typ` not in `allowedTokenTypes` are rejected immediately
5. The public key is fetched from `{issuerUrl}/oauth/v2/keys` (JWKS) using the Web Crypto API, with a 5 s timeout, and cached for 5 minutes per `kid`
6. The signature is verified **before** any claim checks
7. `iss` must be present and must equal `issuerUrl` — tokens without an issuer are rejected
8. `exp` must be present and must be in the future (with `clockSkewMs` tolerance) — tokens without an expiry are rejected
9. `nbf` and `iat` are validated with `clockSkewMs` tolerance when present
10. The `x-nextgen-auth-token` header is stripped from all proxied requests to prevent internal state leakage
