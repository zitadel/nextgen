---
name: zitadel-sdk-nuxt
description: >-
  Integrate Zitadel authentication into an existing or custom Nuxt app with
  @zitadel/sdk-nuxt. Use when the user wants login, logout, session handling,
  or protected routes in a Nuxt 4 app and is wiring the SDK by hand rather than
  letting the CLI scaffold a fresh project — registering the Nuxt module,
  reading auth state, or rendering the `<zitadel-login>` / `<zitadel-logout>`
  components.
---

# @zitadel/sdk-nuxt

A Nuxt module, Nitro middleware, and composables that add Zitadel (Nextgen)
auth to a Nuxt 4 app. The module proxies auth traffic same-origin under
`/__nextgen`, verifies the session JWT via JWKS on the server, seeds auth state
into SSR and hydrates it on the client, and gates protected routes.

## When to use

The `zitadel` CLI (`npx @zitadel/cli@alpha setup --framework nuxt`) scaffolds the module,
plugin, login page, and `.env.local` into a fresh or detected Nuxt project —
prefer it for greenfield work. Reach for **this skill** when you are adding auth
to an **existing or custom** Nuxt app by hand, adjusting a scaffolded wiring, or
wiring the middleware without the module.

## Install

```bash
pnpm add @zitadel/sdk-nuxt@alpha
```

Peer dependencies: `nuxt >=4`, `h3 >=1`.

## Integrate

The recommended path is the Nuxt module. Register it under the `nextgen` key:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@zitadel/sdk-nuxt/module'],
  nextgen: {
    protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
    loginPath: '/login',
  },
});
```

The module registers the Nitro middleware and auth plugin and auto-imports the
composables — no manual `server/middleware/auth.ts`. It reads `ZITADEL_URL`,
`NUXT_PUBLIC_ZITADEL_PROJECT_ID`, and the server-only `ZITADEL_PROJECT_SECRET`
from the environment, or from `.env.local` when the environment has none (Nuxt
itself loads only `.env`). A `nextgen.url` or
`runtimeConfig.public.zitadelProjectId` in `nuxt.config.ts` wins over the
variables.

The module also loads the web components in the browser through a client-only
plugin and provides the business copy overlay as
`useNuxtApp().$zitadelBusinessLocales`. Do not install or import
`@zitadel/components` in the app.

Login and logout pages bind the project handle from `useZitadelProject()` inside
`<ClientOnly>`; navigation after each flow is driven by the URL props (there is
no `api-base` attribute):

```vue
<script setup lang="ts">
const project = useZitadelProject();
</script>

<template>
  <ClientOnly>
    <zitadel-login :project="project" post-sign-in-url="/admin" />
    <!-- on a logout page: -->
    <zitadel-logout :project="project" post-sign-out-url="/login" />
  </ClientOnly>
</template>
```

Read auth state in any component via the auto-imported `useAuth()` (it omits the
raw JWT by design). When you need the token to call upstream APIs, use
`getAuth(event)` from `@zitadel/sdk-nuxt/server` inside a server route:

```ts
import { getAuth } from '@zitadel/sdk-nuxt/server';

export default defineEventHandler((event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) throw createError({ statusCode: 401 });
  return { userId: auth.session.userId };
});
```

The other middleware options (`ignoredRoutes`, `audience`,
`allowedAlgorithms`, `clockSkewMs`, the timeouts) go under `nextgen` too, and a
built server takes each one from `NUXT_NEXTGEN_<OPTION>` (a list as JSON). Only
an app without the module hand-rolls `server/middleware/auth.ts` with
`createNextgenMiddleware(...)` from `@zitadel/sdk-nuxt/server`.

## Widget props and events

The widget props are documented in the `@zitadel/sdk-vue` skill; the table below lists the events.

The widgets are plain custom elements, so each event is a DOM `CustomEvent` that carries its payload in `detail`. The events and payloads are the same ones every SPA SDK exposes as callbacks.

| Widget event | Fires when | Detail | Widgets |
| --- | --- | --- | --- |
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session |

```vue
<zitadel-login :project="project" post-sign-in-url="/admin" @zitadel-flow-complete="track" />
```

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-nuxt/README.md` and the bundled
`.d.ts` types (`dist/index.d.ts`, `dist/server.d.ts`) are authoritative and
versioned with the installed package — read them before wiring anything, and let
them override anything remembered. This skill teaches the pattern, not a full
catalog of options, attributes, or the shared JWT-verification pipeline (that
lives in `@zitadel/sdk-core`). Check the exact option names, defaults, and
component attributes against the installed version rather than assuming.

## Gotchas

- **Project id is mandatory.** Without `NUXT_PUBLIC_ZITADEL_PROJECT_ID` (or
  `runtimeConfig.public.zitadelProjectId`) the plugin silently skips
  `configureZitadel()`, so `useZitadelProject()` is `null` and
  `<zitadel-login>` never initializes.
- **Do not depend on `@zitadel/components`.** The module loads the elements
  itself; importing them in a page `<script setup>` would run during SSR, so
  leave that to the module and wrap the elements in `<ClientOnly>`.
- **Keep `proxyPath` at `/__nextgen` for external sign-in.** The module moves
  the server proxy and the widgets together, but a provider returns the browser
  to `/__nextgen/idp/{slug}/callback`, which is proxied only under the default
  prefix.
- **`useAuth()` never carries the JWT.** It is omitted so the token is not
  serialized into the SSR payload; use `getAuth(event)` server-side for it.
