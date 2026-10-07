---
name: zitadel-sdk-vue
description: >-
  Integrate Zitadel authentication into a Vue 3 single-page app with
  @zitadel/sdk-vue. Use when the user wants to add Zitadel login, logout, or a
  signed-in session card to an existing or custom Vue/Vite SPA — wiring the
  configureZitadel handle, the ZitadelLogin / ZitadelLogout / ZitadelSession
  components, the same-origin backend proxy, and post-sign-in / post-sign-out
  redirects.
---

# @zitadel/sdk-vue

`@zitadel/sdk-vue` provides Vue 3 components wrapping the Zitadel auth UI web
components (`ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`) for client-side
SPAs (Vite, etc.). You configure one project handle with `configureZitadel(...)`
and hand it to the components; they talk to the backend over a same-origin
proxy path.

## When to use

Reach for this skill when integrating Zitadel into an **existing or custom** Vue
app, where you are adding the components by hand.

For a **fresh** scaffold, prefer the CLI instead — it wires the proxy, env, and
components for you:

```sh
npx @zitadel/cli@alpha setup --framework vue --non-interactive --json
```

Use this skill when `setup` is not appropriate (an app with its own structure,
a partial integration, or customizing what the CLI produced).

## Install

```sh
npm install @zitadel/sdk-vue
```

Requires Vue ≥ 3 (peer dependency) and TypeScript ≥ 5.0 (the published types use
`export type *`).

## Integrate

Configure once with `configureZitadel(...)`, then pass the returned handle as
`:project` to each component. The components register the underlying web
components on import — no Vue plugin or `app.use(...)` is needed.

```vue
<script setup lang="ts">
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-vue';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});
</script>

<template>
  <ZitadelLogin :project="project" purpose="login" postSignInUrl="/" />
</template>
```

Logout and the signed-in session card take the same `:project` handle:

```vue
<ZitadelLogout :project="project" postSignOutUrl="/login" />
<ZitadelSession :project="project" />
```

- `purpose` on `ZitadelLogin` is `"login"` by default (also accepts the other
  flow purposes, e.g. registration).
- `postSignInUrl` / `postSignOutUrl` are where the browser lands after the flow.
- The widgets call `${proxyPath}/…` **same-origin** (default `/__nextgen`), so
  your host must proxy that path to the Zitadel backend. For local development
  you can instead point `proxyPath` straight at the backend cross-origin, e.g.
  `proxyPath: 'http://localhost:8080'` (the `zitadel start` local runtime port).

## Read these, don't guess

The SDK and this skill version independently — discover the real surface before
writing code, and treat it as authoritative over anything here:

- `node_modules/@zitadel/sdk-vue/README.md` — the installed README.
- `node_modules/@zitadel/sdk-vue/dist/index.d.ts` — the TypeScript types: the
  exact exports and every component prop. The public exports are
  `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `configureZitadel`,
  `getApi`, `getZitadelConfig`, the `ZitadelConfig` / `ZitadelProject` types,
  and `businessLocales`.

Check the installed version's props rather than assuming; emitted events and
optional props (`locales`, `lang`, `theme`, `variant`, `suppressHeader`, …)
evolve.

## Gotchas

- **Production SPA deployment is not yet supported.** The same-origin proxy path
  must come from your hosting platform, and the CLI cannot scaffold those host
  configs yet (see ADR 036 and zitadel/nextgen#560). The CLI dev proxy covers
  local development only.
- **Same-origin by default.** Unless you override `proxyPath`, the widgets
  expect `/__nextgen` to be proxied to the backend on the same origin — a bare
  SPA with no proxy will fail its auth calls.
- **TypeScript ≥ 5.0 is required**; older compilers choke on the `export type *`
  re-exports in the published type definitions.
