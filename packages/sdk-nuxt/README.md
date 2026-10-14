# @zitadel/sdk-nuxt

Nuxt module, Nitro middleware, and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-nuxt@alpha
```

There are two ways to wire the SDK. **The module is what `zitadel setup`
scaffolds** and the recommended path; the direct-middleware surface remains
for hand-rolled setups.

## Surface 1 — the Nuxt module (recommended, CLI-scaffolded)

Register the module under the `nextgen` config key:

```ts
export default defineNuxtConfig({
  modules: ['@zitadel/sdk-nuxt/module'],
  nextgen: {
    protectedRoutes: ['/admin', '/dashboard*'],
    loginPath: '/login',
  },
});
```

The module registers the Nitro server middleware, the auth plugin (which
seeds server-side auth state, hydrates it on the client, and calls
`configureZitadel()` from runtime config), and auto-imports the
composables — no `server/middleware/auth.ts`, no manual plugin.

It takes three settings from the environment, or from `.env.local` when the
environment has none. Nuxt itself loads only `.env`; `zitadel setup` writes
all three to `.env.local` and the module registration to `nuxt.config.ts`:

| Variable | Sets | Without it |
| --- | --- | --- |
| `ZITADEL_URL` | `nextgen.url`, unless `nuxt.config.ts` sets it | `http://localhost:8080` |
| `NUXT_PUBLIC_ZITADEL_PROJECT_ID` | `runtimeConfig.public.zitadelProjectId`, unless `nuxt.config.ts` sets it | the plugin skips `configureZitadel()`, `useZitadelProject()` returns `null`, and the login widget cannot initialize |
| `ZITADEL_PROJECT_SECRET` | the server-only `runtimeConfig.nextgen.projectSecret` | sign-in cannot finish: the session exchange has no credential |

The module reads them when `nuxt dev` or `nuxt build` runs, and a build keeps
what it found. For a built server, set `NUXT_NEXTGEN_URL`,
`NUXT_PUBLIC_ZITADEL_PROJECT_ID`, and `NUXT_NEXTGEN_PROJECT_SECRET` in its
runtime environment instead.

### Module options

The module takes every option in the [options table](#options) under
`nextgen` and hands it to the server middleware, so `audience`,
`ignoredRoutes`, and the others apply just as they do in Surface 2; the
widgets call the same `proxyPath` the server proxies. A built server also takes
each option from its runtime environment as `NUXT_NEXTGEN_<OPTION>`, for
example `NUXT_NEXTGEN_AUDIENCE=my-api` or
`NUXT_NEXTGEN_IGNORED_ROUTES='["/health"]'`: a list as JSON, or one entry as a
plain string. `proxyPath` is the exception: the widgets read their copy from
public runtime config, so change it in `nuxt.config.ts`, where the module sets
both.

### Reading auth state

`useAuth()` is auto-imported:

```vue
<script setup lang="ts">
const auth = useAuth();
</script>

<template>
  <p>{{ auth.isAuthenticated ? (auth.session.display ?? auth.session.identifier) : 'Not signed in' }}</p>
</template>
```

The returned state intentionally omits the raw session token — use `getAuth(event)` in
a server route when you need the token to call upstream APIs:

```ts
import { getAuth } from '@zitadel/sdk-nuxt/server';

export default defineEventHandler((event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) {
    // Zitadel could not be asked: an outage, not a sign-out.
    if (auth.reason === 'unavailable') throw createError({ statusCode: 503 });
    throw createError({ statusCode: 401 });
  }
  return { userId: auth.session.userId };
});
```

Never return `getAuth(event)` itself from a route the browser calls: it carries
the session token, which Zitadel sets as an HttpOnly cookie so no script can
read it. Return `getClientAuth(event)` instead, the same state without the
token.

### Login page

Register the shared components in a client-only plugin
(`plugins/zitadel-components.client.ts` — do **not** import
`@zitadel/components` from page `<script setup>`, that runs during SSR).
Under strict package managers (pnpm, Yarn PnP) `@zitadel/components` is not
resolvable as a transitive dependency, so declare it in your app first:

```bash
pnpm add @zitadel/components@alpha
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

### Session widgets

`<zitadel-session>` (the signed-in card for a profile page) and
`<zitadel-logout>` (the avatar menu) are bound the same way. Nuxt templates use
the raw elements, so listen to their events directly: `@zitadel-signout` after
a sign-out, and `@zitadel-session-missing` when the widget finds no session as
it loads. Without a session both widgets render nothing, and the card also goes
to its `post-sign-out-url` when one is set, unless that URL is the page the
card is on:

```vue
<script setup lang="ts">
const project = useZitadelProject();
const onSessionMissing = () => console.info("no session");
</script>

<template>
  <ClientOnly>
    <zitadel-session
      :project="project"
      post-sign-out-url="/login"
      @zitadel-session-missing="onSessionMissing"
    />
  </ClientOnly>
</template>
```

A failure that is not the backend saying "no session" (a gateway's error
page, a 5xx, a network error) keeps the widget, shows the error and fires
`@zitadel-session-error`, whose detail carries `phase` (`load` or `signout`),
`message` and, when a response came back, `status` and `code`. See the
`@zitadel/components` README for the full rule.

## Surface 2 — direct middleware (hand-rolled)

Without the module, create `server/middleware/auth.ts` yourself:

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

### Options

Both surfaces take these options: the module under `nextgen` in
`nuxt.config.ts`, the middleware as its argument.

| Option              | Type                 | Default                  | Description                                                                                                                |
| ------------------- | -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | `string`             | `ZITADEL_URL` env (the module also reads `.env.local`), else `http://localhost:8080` | Full URL of the Zitadel auth backend                                                                                       |
| `proxyPath`         | `string`             | `"/__nextgen"`           | Path prefix proxied to the auth backend. Sign-in with an external provider currently requires the default: the provider returns to `/__nextgen/idp/{slug}/callback` |
| `protectedRoutes`   | `string[]`           | `[]`                     | Paths requiring a valid session. Trailing `*` matches sub-paths                                                            |
| `ignoredRoutes`     | `string[]`           | `[]`                     | Paths skipped entirely — no JWT check, no tunnelling. Useful for webhooks or health checks. Trailing `*` matches sub-paths |
| `loginPath`         | `string`             | `"/login"`               | Where to redirect unauthenticated users. Setup fails if `protectedRoutes` matches it and `ignoredRoutes` does not                                                                                    |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]`     | JWT `alg` values to accept. Tokens with any other algorithm are rejected before JWKS is fetched                            |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`      | Accepted `typ` header values (case-insensitive). Set to `[]` to disable this check                                         |
| `clockSkewMs`       | `number`             | `5000`                   | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                                                                         |
| `jwksTimeoutMs`     | `number`             | `5000`                   | Timeout in ms for JWKS endpoint requests. Token is rejected if the fetch exceeds this window                               |
| `opaqueTokenTimeoutMs` | `number`          | `5000`                   | Timeout in ms for opaque (non-JWT) session validation via `GET /sessions/me`. Only Zitadel's `401 auth.unauthorized` or `404 sess.not_found` clears the cookie; a timeout, network error, `5xx` or a gateway's `401`/`404` keeps it, reports `reason: "unavailable"` and answers a protected route `503` |
| `proxyTimeoutMs`    | `number`             | `5000`                   | Timeout in ms for upstream proxy requests. A request exceeding it is answered `504`; an unreachable backend `502`, both with a `{ code, message }` body |
| `projectSecret`     | `string`             | `runtimeConfig.nextgen.projectSecret`, else `ZITADEL_PROJECT_SECRET` env | Project secret, sent as the bearer on the `POST /sessions/exchange` handoff only (server-only). Middleware argument only: the module reads `ZITADEL_PROJECT_SECRET` itself (see the table above), never from `nuxt.config.ts` |
| `audience`          | `string \| string[]` | not validated            | Expected `aud` claim value(s). When omitted, audience is not checked                                                       |

## How JWT verification works

The verification pipeline is shared across SDKs and documented once in
[`@zitadel/sdk-core`](https://github.com/zitadel/nextgen/tree/main/packages/sdk-core#how-jwt-verification-works).
On top of it, the Nitro middleware strips the `x-nextgen-auth-token` header
from all proxied requests to prevent internal state leakage.
