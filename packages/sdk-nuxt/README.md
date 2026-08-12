# @zitadel/sdk-nuxt

Nuxt module, Nitro middleware, and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-nuxt
```

There are two ways to wire the SDK. **The module is what `zitadel setup`
scaffolds** and the recommended path; the direct-middleware surface remains
for hand-rolled setups.

## Surface 1 — the Nuxt module (recommended, CLI-scaffolded)

Register the module under the `nextgen` config key, and give the client
plugin your project id via `runtimeConfig.public.zitadelProjectId` — without
it the plugin skips `configureZitadel()`, `useZitadelProject()` returns
`null`, and the login widget cannot initialize:

```ts
export default defineNuxtConfig({
  modules: ['@zitadel/sdk-nuxt/module'],
  nextgen: {
    url: process.env.ZITADEL_URL ?? 'http://localhost:8080',
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  },
  runtimeConfig: {
    public: {
      zitadelProjectId: process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ?? '',
    },
  },
});
```

(This mirrors what `zitadel setup` writes into `nuxt.config.ts`.)

The module registers the Nitro server middleware, the auth plugin (which
seeds server-side auth state, hydrates it on the client, and calls
`configureZitadel()` from the runtime config above), and auto-imports the
composables — no `server/middleware/auth.ts`, no manual plugin.

### Module options (what the module actually forwards)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | `ZITADEL_URL` env, else `http://localhost:8080` | Full URL of the Zitadel auth backend |
| `proxyPath` | `string` | `"/__nextgen"` | The path the **client** widgets call (exposed via public runtime config). The registered server handler currently always serves `/__nextgen` regardless of this option — to actually move the server prefix, use the direct-middleware surface |
| `protectedRoutes` | `string[]` | `[]` | Paths requiring a valid session. Trailing `*` matches sub-paths |
| `loginPath` | `string` | `"/login"` | Where to redirect unauthenticated users |

The module's registered handler forwards only the options above. The
fine-tuning options of the direct-middleware surface (`ignoredRoutes`,
`allowedAlgorithms`, `allowedTokenTypes`, `clockSkewMs`, `jwksTimeoutMs`,
`opaqueTokenTimeoutMs`, `proxyTimeoutMs`, `audience`) are **not currently
forwarded by the module** — if you need them, use Surface 2. The module also
loads the server-only project secret into runtime config
(override at deploy time via `NUXT_NEXTGEN_PROJECT_SECRET`).

### Reading auth state

`useAuth()` is auto-imported:

```vue
<script setup lang="ts">
const auth = useAuth();
</script>

<template>
  <p>{{ auth.isAuthenticated ? auth.session.email : 'Not signed in' }}</p>
</template>
```

The returned state intentionally omits the raw JWT — use `getAuth(event)` in
a server route when you need the token to call upstream APIs:

```ts
import { getAuth } from '@zitadel/sdk-nuxt/server';

export default defineEventHandler((event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) throw createError({ statusCode: 401 });
  return { userId: auth.session.userId };
});
```

### Login page

Register the shared components in a client-only plugin
(`plugins/zitadel-components.client.ts` — do **not** import
`@zitadel/components` from page `<script setup>`, that runs during SSR).
Under strict package managers (pnpm, Yarn PnP) `@zitadel/components` is not
resolvable as a transitive dependency, so declare it in your app first:

```bash
pnpm add @zitadel/components
```

```ts
import "@zitadel/components";

export default defineNuxtPlugin(() => {});
```

Then render `<zitadel-login>` inside `<ClientOnly>`, binding the project
handle from the auto-imported `useZitadelProject()` composable — there is no
`api-base` attribute:

```vue
<script setup lang="ts">
const project = useZitadelProject();
</script>

<template>
  <main>
    <ClientOnly>
      <zitadel-login :project="project" post-sign-in-url="/admin" />
    </ClientOnly>
  </main>
</template>
```

## Surface 2 — direct middleware (hand-rolled)

Create `server/middleware/auth.ts` yourself when you need the full option
set:

```ts
import { createNextgenMiddleware } from '@zitadel/sdk-nuxt/server';

const { nextgen } = useRuntimeConfig();

export default createNextgenMiddleware({
  url: nextgen.url,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend
2. **Verifies** the session JWT via JWKS using the Web Crypto API
3. **Redirects** unauthenticated requests to `loginPath` for protected routes

### Direct-middleware options

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
| `opaqueTokenTimeoutMs` | `number`          | `5000`                   | Timeout in ms for opaque (non-JWT) session validation via `GET /sessions/me`                                               |
| `proxyTimeoutMs`    | `number`             | `5000`                   | Timeout in ms for upstream proxy requests; requests exceeding it abort with a network error                                |
| `audience`          | `string \| string[]` | not validated            | Expected `aud` claim value(s). When omitted, audience is not checked                                                       |

## How JWT verification works

The verification pipeline is shared across SDKs and documented once in
[`@zitadel/sdk-core`](https://github.com/zitadel/nextgen/tree/main/packages/sdk-core#how-jwt-verification-works).
On top of it, the Nitro middleware strips the `x-nextgen-auth-token` header
from all proxied requests to prevent internal state leakage.
