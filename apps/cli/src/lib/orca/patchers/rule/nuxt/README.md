# Nuxt patcher

Integrates Zitadel auth into a Nuxt app. Like Next, Nuxt proxies and verifies
the session server-side — here through the `@zitadel/sdk-nuxt` module.

## What it patches

- `app.vue` — router root
- `pages/login.vue`, `pages/register.vue`, `pages/profile.vue` — auth pages
- `plugins/zitadel-components.client.ts` — registers the widgets in the browser only (and, for the
  business use case, provides the `businessLocales` overlay to the pages). The module's own plugin
  seeds the auth state, so setup no longer writes `plugins/auth.server.ts`; eject still removes the
  copy an older setup wrote
- `nuxt.config.*` — registers `@zitadel/sdk-nuxt/module`, sets the login path and `/profile` as a protected route, adds the components to `build.transpile`, and marks the `zitadel-*` elements as custom elements (edits the first matching `nuxt.config.{ts,mts,js,mjs}`). It writes no backend URL or project id: those come from `.env.local`
- `.env.example`, `.env.local` — `NUXT_PUBLIC_ZITADEL_PROJECT_ID` (client-exposed),
  plus the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`, `ZITADEL_ENVIRONMENT`) —
  Nuxt loads only `.env`, so the module reads `ZITADEL_URL`,
  `NUXT_PUBLIC_ZITADEL_PROJECT_ID`, and `ZITADEL_PROJECT_SECRET` from `.env.local`
  itself when the environment does not set them
- `package.json` — adds `@zitadel/sdk-nuxt` and `@zitadel/components` (the client plugin imports
  the components directly, which pnpm and Yarn PnP resolve only for a declared dependency), pinned
  at the CLI's own version

## How the proxy works

The `@zitadel/sdk-nuxt` module registers server middleware that proxies
`/__nextgen/*` to the backend and verifies the session. There is no dev-only
proxy, so it works the same in production.
