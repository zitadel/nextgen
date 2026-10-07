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

The `zitadel` CLI (`zitadel setup --framework nuxt`) scaffolds the module,
plugin, login page, and `.env.local` into a fresh or detected Nuxt project —
prefer it for greenfield work. Reach for **this skill** when you are adding auth
to an **existing or custom** Nuxt app by hand, adjusting a scaffolded wiring, or
need the direct-middleware surface the module does not expose.

## Install

```bash
pnpm add @zitadel/sdk-nuxt
# login/logout web components are a separate, non-transitive dependency under
# strict package managers (pnpm, Yarn PnP) — declare it explicitly:
pnpm add @zitadel/components
```

Peer deps: `nuxt >=4`, `h3 >=1`.

## Integrate

The recommended path is the Nuxt module. Register it under the `nextgen` key and
give the client plugin your project id via public runtime config — without it
`useZitadelProject()` returns `null` and the login widget cannot initialize.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@zitadel/sdk-nuxt/module'],
  nextgen: {
    url: process.env.ZITADEL_URL ?? 'http://localhost:8080',
    protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
    loginPath: '/login',
  },
  runtimeConfig: {
    public: {
      zitadelProjectId: process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ?? '',
    },
  },
});
```

The module registers the Nitro middleware and auth plugin and auto-imports the
composables — no manual `server/middleware/auth.ts`. It also loads the
server-only secret from `ZITADEL_PROJECT_SECRET` (or scaffolded `.env.local`).

Register the web components in a **client-only** plugin — importing
`@zitadel/components` from a page `<script setup>` runs during SSR and breaks:

```ts
// plugins/zitadel-components.client.ts
import '@zitadel/components';
export default defineNuxtPlugin(() => {});
```

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

Need the full option set (`ignoredRoutes`, `audience`, `clockSkewMs`, the
timeouts, a moved server proxy prefix)? Skip the module and hand-roll
`server/middleware/auth.ts` with `createNextgenMiddleware(...)` from
`@zitadel/sdk-nuxt/server` — the module does not forward those options.

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-nuxt/README.md` and the bundled
`.d.ts` types (`dist/index.d.ts`, `dist/server.d.ts`) are authoritative and
versioned with the installed package — read them before wiring anything, and let
them override anything remembered. This skill teaches the pattern, not a full
catalog of options, attributes, or the shared JWT-verification pipeline (that
lives in `@zitadel/sdk-core`). Check the exact option names, defaults, and
component attributes against the installed version rather than assuming.

## Gotchas

- **Project id is mandatory.** Missing `runtimeConfig.public.zitadelProjectId`
  silently skips `configureZitadel()`, so `useZitadelProject()` is `null` and
  `<zitadel-login>` never initializes.
- **`@zitadel/components` is not transitive** under strict package managers —
  add it to the app directly or imports fail to resolve.
- **Never import components in page `<script setup>`** — it executes during SSR.
  Use the `.client.ts` plugin and wrap the elements in `<ClientOnly>`.
- **The module's `proxyPath` only configures the client.** The registered server
  handler always serves `/__nextgen`; to actually move the server prefix, use the
  direct-middleware surface.
- **Module options are a subset.** `ignoredRoutes`, `allowedAlgorithms`,
  `allowedTokenTypes`, `clockSkewMs`, the `*TimeoutMs` options, and `audience`
  are not forwarded by the module — only the direct middleware accepts them.
- **`useAuth()` never carries the JWT.** It is omitted so the token is not
  serialized into the SSR payload; use `getAuth(event)` server-side for it.
