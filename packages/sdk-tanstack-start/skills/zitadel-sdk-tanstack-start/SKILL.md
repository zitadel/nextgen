---
name: zitadel-sdk-tanstack-start
description: >-
  Integrate Zitadel authentication into an existing or custom TanStack Start app
  with @zitadel/sdk-tanstack-start. Use when the user wants login, logout,
  session handling, or protected routes in a TanStack Start (React) app and is
  wiring the SDK by hand rather than letting the CLI scaffold a fresh project —
  registering the request middleware in `src/start.ts`, guarding a route with a
  server function, or rendering the `ZitadelLogin` / `ZitadelSession` widgets.
---

# @zitadel/sdk-tanstack-start

TanStack Start request middleware and helpers that add Zitadel (Nextgen) auth to
a TanStack Start app. The middleware proxies auth traffic same-origin under
`/__nextgen`, verifies the session JWT via JWKS on the server, places the result
on the request context as `nextgenAuth`, and redirects unauthenticated requests
on protected routes. Unlike the other meta-framework SDKs it also ships the
widgets (a `/react` entry), so no other Zitadel package is needed.

## When to use

The `zitadel` CLI (`zitadel setup --framework tanstack-start`) scaffolds
`src/start.ts`, login/register/profile routes, and `.env.local` into a fresh or
detected TanStack Start project — prefer it for greenfield work. Reach for
**this skill** when you are adding auth to an **existing or custom** TanStack
Start app by hand, or adjusting a scaffolded wiring.

## Install

```bash
pnpm add @zitadel/sdk-tanstack-start@alpha
```

Peer deps: `@tanstack/react-start >=1`, `react >=18`, `react-dom >=18`.

## Integrate

**1. Request middleware.** Register it in `src/start.ts`, the file TanStack Start
auto-loads, via `requestMiddleware`. Having this file turns off the automatic
CSRF protection for server functions, so list `createCsrfMiddleware` before auth:

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
    protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
    loginPath: '/login',
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authMiddleware],
}));
```

Sessions count only in the app's own project: `projectId`, else
`ZITADEL_PROJECT_ID`, else `VITE_ZITADEL_PROJECT_ID`. With none set, nobody is
signed in.

The same proxy/verify/protect decision is exported as the framework-agnostic
`handleNextgenRequest(request, options)` for a custom server entry.

**2. Read auth and guard routes through a server function.** Server functions
receive the middleware's context; a route's `beforeLoad` does not, and on
client-side navigation it runs in the browser. Call a server function from
`beforeLoad`:

```ts
import { createServerFn } from '@tanstack/react-start';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuth } from '@zitadel/sdk-tanstack-start/server';

// A server function's return value is serialised to the browser, so return
// only client-safe fields: `getAuth` also carries the raw session token.
const fetchAuth = createServerFn().handler(({ context }) => {
  const auth = getAuth(context);
  return auth.isAuthenticated
    ? { isAuthenticated: true as const, userId: auth.session.userId }
    : { isAuthenticated: false as const };
});

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const auth = await fetchAuth();
    if (!auth.isAuthenticated) throw redirect({ to: '/login' });
    return { userId: auth.userId };
  },
});
```

**3. Render the widgets** from the `/react` entry, with `configureZitadel` from
`/client`:

```tsx
import { ZitadelLogin } from '@zitadel/sdk-tanstack-start/react';
import { configureZitadel } from '@zitadel/sdk-tanstack-start/client';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
}
```

`<ZitadelSession project={project} postSignOutUrl="/login" />` renders the
signed-in card with sign-out, and `<ZitadelLogout>` a sign-out control on its own.

## Widget props and events

This SDK is not server-only: its `/react` entry wraps the widgets from `@zitadel/sdk-react`, so no other package is needed. Read the `@zitadel/sdk-react` skill for the widget props and events.

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-tanstack-start/README.md` and
the bundled `.d.ts` types (`dist/server.d.ts`, `dist/client.d.ts`,
`dist/react.d.ts`) are authoritative and versioned with the installed package —
read them before wiring anything, and let them override anything remembered.
This skill teaches the pattern, not a full catalog of options, widget props, or
the shared JWT-verification pipeline (that lives in `@zitadel/sdk-core`). Check
exact option names, props, and defaults against the installed version rather
than assuming.

## Gotchas

- **Import widgets from `/react`, not `/client`.** `/client` only configures the
  SDK and exports no components.
- **The widgets render nothing on the server and during hydration.** They mount
  right after, with every prop in place; do not expect them in the SSR markup.
- **Keep `createCsrfMiddleware` ahead of auth.** `src/start.ts` opts the app out
  of TanStack Start's automatic CSRF protection.
- **`beforeLoad` has no `nextgenAuth`.** Read it with `getAuth(context)` inside a
  server function, not from the route context.
- **Never return `getAuth(context)` itself from a server function.** Its session
  carries the raw token, and a server function's result reaches browser scripts.
  Return only `userId` and other client-safe fields.
- **`protectedRoutes` only guards full document requests.** Client-side `<Link>`
  navigation needs the `beforeLoad` server-function guard; without it only the
  `ZitadelSession` card sends a signed-out visitor away.
