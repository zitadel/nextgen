---
name: zitadel-sdk-next
description: >-
  Integrate Zitadel authentication into a Next.js App Router app with
  @zitadel/sdk-next. Use whenever the user wants to add Zitadel login,
  registration, logout, or session handling to a Next.js project — wiring the
  auth middleware/proxy, reading sessions in Server or Client Components,
  rendering the `<zitadel-login>` UI, or customizing an existing Zitadel + Next
  integration.
---

# @zitadel/sdk-next

Next.js middleware and helpers that wire the Zitadel auth UI and session
verification into an App Router app.

## When to use

Use this when adding or customizing Zitadel auth in an **existing or custom**
Next.js app, or when you need to understand how the pieces fit together.

For a brand-new app, prefer the CLI: `zitadel setup --framework next` scaffolds
the whole integration (middleware, login page, env) and wires it for you. Reach
for this skill when that scaffold already exists and you are editing it, or when
the app is bespoke and you are integrating by hand.

## Install

```bash
pnpm add @zitadel/sdk-next
```

Peer deps the package expects: `next >=15`, `react >=18`, `react-dom >=18`.
TypeScript `>=5.7` (the package itself is built against 5.7).

## Integrate

The package has per-runtime entry points — import from the one that matches
where the code runs, not the root, from client modules:

| Import                         | Runs in                           | Provides                           |
| ------------------------------ | --------------------------------- | ---------------------------------- |
| `@zitadel/sdk-next/middleware` | Edge middleware                   | `nextgenMiddleware`, `createProxy` |
| `@zitadel/sdk-next/server`     | Server Components, Route Handlers | `auth()`, `NextgenProvider`        |
| `@zitadel/sdk-next/react`      | Client Components                 | `useAuth()`, `AuthContextProvider` |
| `@zitadel/sdk-next/session`    | Client Components                 | `getSession()`                     |
| `@zitadel/sdk-next/client`     | Client boundary                   | `configureZitadel()`, web components |

**1. Middleware proxy.** Create `src/proxy.ts`. It proxies `/__nextgen/*` to the
auth backend (same-origin), verifies the session JWT via JWKS, and redirects
unauthenticated users on protected routes:

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

export const config = { matcher: ['/__nextgen/:path*', '/admin', '/login'] };
```

**2. Read the session server-side** with `auth()` (it re-verifies the tunnelled
token — the header alone is never trusted):

```ts
import { auth } from '@zitadel/sdk-next/server';

const session = await auth();
if (!session.isAuthenticated) return <p>Not signed in</p>;
```

**3. Seed client components** by rendering `NextgenProvider` (server-only — it
strips the raw token before the server→client boundary) in your root layout,
then read with `useAuth()` in any client component. For chrome on **public**
pages (which the matcher does not cover), read client-side with `getSession()`
from `@zitadel/sdk-next/session` instead — it fetches same-origin
`{proxyPath}/sessions/me`.

**4. Login page.** Render `<zitadel-login>` client-side only (via
`next/dynamic` with `ssr: false`); call `configureZitadel({ projectId, proxyPath })`
from `@zitadel/sdk-next/client` inside the dynamic import, and set the
`post-sign-in-url` attribute. `<zitadel-logout>` and `<zitadel-session>` exist
for logout and profile UI. Sign-in/out navigate to `post-sign-in-url` /
`post-sign-out-url`, so chrome re-reads on the next page load.

## Read these, don't guess

This skill is the **pattern**, not an API catalog — it deliberately omits exact
prop/option names so it does not drift with the package version. For the
authoritative, version-correct specifics:

- `node_modules/@zitadel/sdk-next/README.md` — the full setup walkthrough with
  every code sample.
- The package's TypeScript types (`.d.ts` per entry point) — exact exported
  names, component props, `configureZitadel()` config, and the full middleware
  options table (`proxyPath`, `ignoredRoutes`, `audience`, `allowedAlgorithms`,
  timeouts, …).

Confirm names against those before writing code.

## Gotchas

- **Never import the package root from a `"use client"` module.** The root
  re-exports the server-only `auth()`; pulling it into a client graph fails the
  build. Client code imports from `/react` or `/session` only.
- **`NextgenProvider` is server-only** and must not be re-exported through a
  `"use client"` `providers.tsx` wrapper — that would leak the unstripped token
  into the RSC flight payload. To seed from client state, use
  `AuthContextProvider` from `/react` (it only takes the token-less shape).
- **Same-origin proxy is required.** The widgets and `getSession()` hit
  `{proxyPath}/sessions/me` on the same origin; the middleware `matcher` must
  cover `{proxyPath}/:path*` or the proxy breaks.
- **`auth()` only sees a session on routes the matcher covers.** A header on an
  unmatched public page always looks signed out — use `getSession()` there.
- **A rejected `getSession()` means *unknown*, not signed out** (broken proxy /
  network / 5xx). Render a neutral or error state, never the signed-out CTA.
- **Config handles:** `ZITADEL_URL` (backend, server-side) and
  `NEXT_PUBLIC_ZITADEL_PROJECT_ID` (passed to `configureZitadel`). If the
  middleware runs with custom verification options, pass the same ones to
  `auth()` so both layers accept the same tokens.
