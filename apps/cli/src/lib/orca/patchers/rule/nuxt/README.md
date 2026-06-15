# Nuxt patcher

Integrates Zitadel auth into a Nuxt app. Like Next, Nuxt proxies and verifies
the session server-side — here through the `@zitadel/sdk-nuxt` module.

## What it patches

- `app.vue` — router root
- `pages/login.vue`, `pages/register.vue`, `pages/profile.vue` — auth pages
- `plugins/zitadel-components.client.ts`, `plugins/auth.server.ts` — widget + session plugins
- `nuxt.config.*` — registers `@zitadel/sdk-nuxt/module`, sets the backend URL, login path, and `/profile` as a protected route, seeds `runtimeConfig` (backend URL, proxy path, project id), and adds the components to `build.transpile` (edits the first matching `nuxt.config.{ts,mts,js,mjs}`)
- `.env.example`, `.env.local` — `NUXT_PUBLIC_ZITADEL_PROJECT_ID` (client-exposed),
  plus the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_ISSUER`, `ZITADEL_URL`, `ZITADEL_ENVIRONMENT`) — the Nuxt config reads
  `ZITADEL_URL`
- `package.json` — adds `@zitadel/sdk-nuxt`

## How the proxy works

The `@zitadel/sdk-nuxt` module registers server middleware that proxies
`/__nextgen/*` to the backend and verifies the session. There is no dev-only
proxy, so it works the same in production.
