# @zitadel/sdk-nuxt

Nuxt module, Nitro middleware, and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-nuxt@alpha
```

There are two ways to wire the SDK. **The module is what `zitadel setup`
scaffolds** and the recommended path; the direct-middleware surface remains
for hand-rolled setups.

## Requirements

Peer dependencies: `nuxt >=4` and `h3 >=1`.

TypeScript ≥ 5.0, the floor shared by every SDK; see the [compatibility notes](https://github.com/zitadel/nextgen/blob/main/packages/AGENTS.md).

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

It takes three settings. Nuxt itself loads only `.env`; `zitadel setup` writes
all three to `.env.local` and the module registration to `nuxt.config.ts`.
`nuxt dev` reads them from the environment, or from `.env.local` when the
environment has none:

| Variable | Sets | Without it |
| --- | --- | --- |
| `ZITADEL_URL` | the backend URL, unless `nextgen.url` or `NUXT_NEXTGEN_URL` sets it | `http://localhost:8080` |
| `NUXT_PUBLIC_ZITADEL_PROJECT_ID` | `runtimeConfig.public.zitadelProjectId`, unless `nuxt.config.ts` sets it | the plugin skips `configureZitadel()`, `useZitadelProject()` returns `null`, and the login widget cannot initialize |
| `ZITADEL_PROJECT_SECRET` | the server-only secret, unless `NUXT_NEXTGEN_PROJECT_SECRET` sets it | sign-in cannot finish: the session exchange has no credential |

The backend URL and the project secret default to `ZITADEL_URL` and
`ZITADEL_PROJECT_SECRET` from the server environment; set `nextgen.url` or the
`NUXT_NEXTGEN_*` variables only to override. A built server reads `ZITADEL_URL`
and `ZITADEL_PROJECT_SECRET` from its own
runtime environment when it starts, and takes `NUXT_NEXTGEN_URL` and
`NUXT_NEXTGEN_PROJECT_SECRET` ahead of them, so one build runs against any
backend. `nuxt build` never copies the URL or the secret from its environment
or from `.env.local` into `.output/`, so the secret exists only where the
server runs; `.env.local` is not read by a built server. A `nextgen.url` in
`nuxt.config.ts` is the exception: you wrote it into the config, so it is part
of the build. `NUXT_PUBLIC_ZITADEL_PROJECT_ID` is public and is still read when
`nuxt build` runs; set it in the runtime environment to change it per
deployment.

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

The module loads the widget elements in the browser for you, through a
client-only plugin, and provides the business copy overlay as
`useNuxtApp().$zitadelBusinessLocales`. There is nothing to install or register
beyond `@zitadel/sdk-nuxt`; do not import `@zitadel/components` yourself.

Render `<zitadel-login>` inside `<ClientOnly>`, binding the project
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

To call the Zitadel API from your own code, use the auto-imported `useZitadelApi()` composable (for example from `onMounted`). It returns the typed client of the project the plugin configured from your project id, and throws if no project id is set, so you do not install `@zitadel/api` either.

```ts
onMounted(async () => {
  const session = await useZitadelApi().getMySession();
});
```

## Widget events

The widgets are plain custom elements, so each event is a DOM `CustomEvent` that carries its payload in `detail`. The events and payloads are the same ones every SPA SDK exposes as callbacks.

| Widget event | Fires when | Detail | Widgets |
| --- | --- | --- | --- |
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, secret: false, value }` for an identifier field, `{ name, secret: true }` for any other | Login |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session |

The `zitadel-flow-input` event is composed, so any script on the page can read it. It carries a field's value only for an identifier field: a `text`, `email` or `tel` field whose `autocomplete` is `username`, `email`, `tel`, `name`, `given-name`, `additional-name`, `family-name` or `nickname`, with no sensitive token (`current-password`, `new-password`, `one-time-code`, `bday*`, `cc-*`, `transaction-*`) beside it. Every other field, a password, a code or a PIN included, is reported as `{ name, secret: true }` with no value. Narrow on `secret` before reading `value`.

```vue
<zitadel-login :project="project" post-sign-in-url="/admin" @zitadel-flow-complete="track" />
```

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
3. **Redirects** unauthenticated requests to `loginPath` for protected routes, with the requested path and query string in `?next=`, where `<zitadel-login>` returns after sign-in

### Options

Both surfaces take these options: the module under `nextgen` in
`nuxt.config.ts`, the middleware as its argument.

| Option              | Type                 | Default                  | Description                                                                                                                |
| ------------------- | -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | `string`             | `ZITADEL_URL` env, read when the server starts (`nuxt dev` also reads `.env.local`), else `http://localhost:8080` | Full URL of the Zitadel auth backend                                                                                       |
| `projectId`         | `string`             | the public project id (`runtimeConfig.public.zitadelProjectId`), else `ZITADEL_PROJECT_ID` at runtime; `createNextgenMiddleware` alone: `ZITADEL_PROJECT_ID`, else `NUXT_PUBLIC_ZITADEL_PROJECT_ID` | The project this app signs its users in to. A session of any other project on the server reads as signed out and keeps its cookie; with no project, no session counts. A built server takes it from `NUXT_NEXTGEN_PROJECT_ID` |
| `proxyPath`         | `string`             | `"/__nextgen"`           | Path prefix proxied to the auth backend. Sign-in with an external provider currently requires the default: the provider returns to `/__nextgen/idp/{slug}/callback` |
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
On top of it, the Nitro middleware refuses with a 400 any request that carries
an `x-nextgen-auth-token` header: that header is an internal channel, so a
client never sends it.
