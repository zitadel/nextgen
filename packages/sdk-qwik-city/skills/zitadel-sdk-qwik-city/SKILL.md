---
name: zitadel-sdk-qwik-city
description: >-
  Integrate Zitadel authentication into an existing or custom Qwik City app with
  @zitadel/sdk-qwik-city. Use when the user wants login, logout, session
  handling, or protected routes in a Qwik 2 (Qwik City) app and is wiring the
  SDK by hand rather than letting the CLI scaffold a fresh project — adding the
  request handler, reading auth state in a `routeLoader$`, or rendering the
  `ZitadelLogin` / `ZitadelSession` widgets.
---

# @zitadel/sdk-qwik-city

A Qwik City request handler and helpers that add Zitadel (Nextgen) auth to a
Qwik 2 app. The handler proxies auth traffic same-origin under `/__nextgen`,
verifies the session JWT via JWKS on the server, stores the result on
`requestEvent.sharedMap`, and redirects unauthenticated requests on protected
routes. The package is server-only; the widgets come from `@zitadel/sdk-qwik`.

## When to use

The `zitadel` CLI (`zitadel setup --framework qwik-city`) scaffolds the handler
plugin, login/register/profile routes, and `.env.local` into a fresh or detected
Qwik City project — prefer it for greenfield work. Reach for **this skill** when
you are adding auth to an **existing or custom** Qwik City app by hand, or
adjusting a scaffolded wiring.

## Install

```bash
pnpm add -D @zitadel/sdk-qwik-city@alpha
# the login/logout/session widgets are a separate package:
pnpm add -D @zitadel/sdk-qwik@alpha
```

Install both as **dev dependencies**: Qwik bundles `devDependencies` into the
server build and leaves `dependencies` external. Peer deps: `@qwik.dev/core` and
`@qwik.dev/router`, both `^2.0.0-beta.45`. A Qwik 1 app (`@builder.io/qwik-city`)
must migrate to `@qwik.dev/*` first.

## Integrate

**1. Request handler.** Add a root plugin, e.g. `src/routes/plugin@nextgen.ts`:

```ts
import { createNextgenOnRequest } from '@zitadel/sdk-qwik-city/server';

export const onRequest = createNextgenOnRequest({
  protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
  loginPath: '/login',
});
```

`url` and `projectSecret` default to `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`,
read per request from Qwik City's `requestEvent.env` (where Vite loads
`.env.local`), falling back to `process.env`; pass them only to override.
Sessions count only in the app's own project: `projectId`, else
`ZITADEL_PROJECT_ID`, else `PUBLIC_ZITADEL_PROJECT_ID`, read the same way. With
none set, nobody is signed in. To run
alongside your own handler, export an array: `[createNextgenOnRequest({...}), myOnRequest]`.

**2. Read auth server-side** with `getAuth(ev)` in a `routeLoader$`, action, or
endpoint:

```ts
import { routeLoader$ } from '@qwik.dev/router';
import { getAuth } from '@zitadel/sdk-qwik-city/server';

export const useUser = routeLoader$((ev) => {
  const auth = getAuth(ev);
  if (!auth.isAuthenticated) throw ev.redirect(302, '/login');
  return { userId: auth.session.userId };
});
```

`protectedRoutes` only guards full page loads. To keep a route from rendering at
all without a session, export a loader like this one from the route itself —
Qwik City runs it on the server for `<Link>` navigation too.

**3. Render the widgets** from `@zitadel/sdk-qwik`:

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

const project = configureZitadel({
  projectId: import.meta.env.PUBLIC_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});

export default component$(() => (
  <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />
));
```

`<ZitadelSession project={project} postSignOutUrl="/login" />` renders the
signed-in card with sign-out, and `<ZitadelLogout>` a sign-out control on its own.

## Widget props and events

This SDK is server-only. The widgets come from `@zitadel/sdk-qwik`, so read its skill for the widget props and events.

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-qwik-city/README.md` and the
bundled `.d.ts` types (`dist/server.d.ts`, `dist/client.d.ts`) are authoritative
and versioned with the installed package — read them before wiring anything, and
let them override anything remembered. This skill teaches the pattern, not a
full catalog of options or the shared JWT-verification pipeline (that lives in
`@zitadel/sdk-core`). For widget props and QRL callbacks, read
`node_modules/@zitadel/sdk-qwik/README.md` and its types. Check exact option
names and defaults against the installed version rather than assuming.

## Gotchas

- **Qwik 2 only.** Imports come from `@qwik.dev/core` and `@qwik.dev/router`
  (not `@builder.io/qwik-city`); a Qwik 1 app will not satisfy the peer range.
- **Dev dependency, not dependency.** Qwik's starter `vite.config.ts` throws if a
  package is listed in both sections, and a regular dependency stays external to
  the server bundle.
- **`@zitadel/sdk-qwik-city` renders no widgets.** They come from
  `@zitadel/sdk-qwik`.
- **Env comes from `requestEvent.env`.** Vite loads `.env.local` there, not onto
  `process.env`, so the handler reads it per request.
- **Client-side `<Link>` navigation skips the handler.** Without a route
  loader guard, only the `ZitadelSession` card sends a signed-out visitor away.
