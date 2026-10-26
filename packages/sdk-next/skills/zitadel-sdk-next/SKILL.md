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

For a brand-new app, prefer the CLI: `npx @zitadel/cli@latest setup --framework next` scaffolds
the whole integration (middleware, login page, env) and wires it for you. Reach
for this skill when that scaffold already exists and you are editing it, or when
the app is bespoke and you are integrating by hand.

## Install

```bash
pnpm add @zitadel/sdk-next@latest
```

Peer deps the package expects: `next >=15.2.3`, `react >=18`, `react-dom >=18`.
TypeScript `>=5.0` (the SDK consumer floor; the package is built against a
newer TypeScript, but that does not raise the floor for your project).

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
| `@zitadel/sdk-next/components` | Client Components                 | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession` |

**1. Request-boundary proxy.** It proxies `/__nextgen/*` to the auth backend
(same-origin), verifies the session JWT via JWKS, and redirects unauthenticated
users on protected routes. **The filename and exported function depend on the
Next.js major version** — `proxy.ts`/`proxy` is Next 16+, while Next 15 uses the
request middleware:

- **Next 16+:** create `src/proxy.ts` exporting `proxy`.
- **Next 15:** create `src/middleware.ts` exporting `middleware`.

The body is the same either way (only the file and function name change):

```ts
// Next 16+: src/proxy.ts, exporting `proxy`.
// Next 15:  src/middleware.ts, exporting `middleware` (rename the function).
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

When unsure which the installed Next.js uses, check the CLI's own output — its
patcher emits `middleware.ts` for Next 15 and `proxy.ts` for Next 16+.

**2. Read the session server-side** with `auth()` (it re-verifies the tunnelled
token — the header alone is never trusted):

```tsx
import { auth } from '@zitadel/sdk-next/server';

// Render <Greeting /> inside <Suspense>: with Cache Components on (the
// create-next-app default), Next.js refuses request data outside it.
async function Greeting() {
  const session = await auth();
  if (!session.isAuthenticated) return <p>Not signed in</p>;
  return <p>Hello {session.session.display ?? session.session.userId}</p>;
}
```

**3. Seed client components** by rendering `NextgenProvider` (server-only — it
strips the raw token before the server→client boundary) in your root layout,
then read with `useAuth()` in any client component. For chrome on **public**
pages (which the matcher does not cover), read client-side with `getSession()`
from `@zitadel/sdk-next/session` instead — it fetches same-origin
`{proxyPath}/api/v1/sessions/me`.

**4. Login page.** Render `ZitadelLogin` from `@zitadel/sdk-next/components`
client-side only (via `next/dynamic` with `ssr: false`); call
`configureZitadel({ projectId, proxyPath })` from the same entry inside the
dynamic import, and set the `postSignInUrl` prop. `ZitadelLogout` and
`ZitadelSession` exist for logout and profile UI. Sign-in/out navigate to `post-sign-in-url` /
`post-sign-out-url`, so chrome re-reads on the next page load.

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` from `@zitadel/sdk-next/components` are the `@zitadel/sdk-react` wrappers, so they take the same camelCase props, which the `@zitadel/sdk-react` skill lists. They set object props such as `project` and `locales` as element properties on React 18 and 19, through server-rendered hydration too. The table below lists the events and their callbacks.

Each widget event reaches the callback in the last column, which receives the event's `detail` payload.

| Widget event | Fires when | Detail | Widgets | Callback |
| --- | --- | --- | --- | --- |
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `onFlowStep` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `onFlowInput` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `onFlowComplete` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `onFlowRedirect` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `onFlowError` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `onSignout` |

```tsx
<ZitadelLogin project={project} theme="light" onFlowComplete={(detail) => track(detail)} />
```

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
  `{proxyPath}/api/v1/sessions/me` on the same origin; the middleware `matcher` must
  cover `{proxyPath}/:path*` or the proxy breaks.
- **`auth()` only sees a session on routes the matcher covers.** A header on an
  unmatched public page always looks signed out — use `getSession()` there.
- **A rejected `getSession()` means *unknown*, not signed out** (broken proxy /
  network / 5xx). Render a neutral or error state, never the signed-out CTA.
- **Config handles:** `ZITADEL_URL` (backend, server-side),
  `ZITADEL_PROJECT_ID` (server-side) and `NEXT_PUBLIC_ZITADEL_PROJECT_ID`
  (passed to `configureZitadel`). If the middleware runs with custom
  verification options, pass the same ones to `auth()` so both layers accept
  the same tokens.
- **Sessions count only in the app's own project:** `projectId`, else
  `ZITADEL_PROJECT_ID`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`. With none set,
  nobody is signed in. A session of another project on the same host reads as
  signed out.
