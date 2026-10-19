# Nuxt patcher

Integrates Zitadel auth into a Nuxt app. Like Next, Nuxt proxies and verifies
the session server-side — here through the `@zitadel/sdk-nuxt` module.

## What it patches

- `app.vue` — router root
- `pages/login.vue`, `pages/register.vue`, `pages/profile.vue` — auth pages
- `nuxt.config.*` — registers `@zitadel/sdk-nuxt/module`, sets the login path and `/profile` as a protected route, and marks the `zitadel-*` elements as custom elements (edits the first matching `nuxt.config.{ts,mts,js,mjs}`). It writes no backend URL or project id: those come from `.env.local`
- `.env.example`, `.env.local` — `NUXT_PUBLIC_ZITADEL_PROJECT_ID` (client-exposed),
  plus the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`, `ZITADEL_ENVIRONMENT`) —
  Nuxt loads only `.env`, so the module reads `ZITADEL_URL`,
  `NUXT_PUBLIC_ZITADEL_PROJECT_ID`, and `ZITADEL_PROJECT_SECRET` from `.env.local`
  itself when the environment does not set them
- `package.json` — adds `@zitadel/sdk-nuxt` (and nothing else from `@zitadel/*`)

## No plugins

Setup writes no plugin: the `@zitadel/sdk-nuxt` module loads the widgets in the browser, provides the
business copy overlay as `useNuxtApp().$zitadelBusinessLocales`, and seeds the auth state. The pages
import nothing from `@zitadel/*` (the module auto-imports `useZitadelProject`), so the app depends on
the SDK only. Older setups wrote `plugins/zitadel-components.client.ts` and `plugins/auth.server.ts`;
eject still removes them, and `doctor --fix` drops their records once they are gone.

## How the proxy works

The `@zitadel/sdk-nuxt` module registers server middleware that proxies
`/__nextgen/*` to the backend and verifies the session. There is no dev-only
proxy, so it works the same in production.
