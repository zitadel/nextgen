# SvelteKit patcher

Integrates Zitadel auth into a SvelteKit app. Like Next and Nuxt, SvelteKit proxies and
verifies the session server-side — here through the `createNextgenHandle` hook from
`@zitadel/sdk-sveltekit`.

The detector requires `@sveltejs/kit` 2 or newer and `svelte` 5 or newer (the widgets come
from `@zitadel/sdk-svelte`, which is written with runes); older versions are refused.

## What it patches

- `src/hooks.server.ts` — the server hook (infrastructure): proxies `/__nextgen/*`,
  verifies the session, and redirects unauthenticated requests for `/profile` to `/login`
- `src/routes/+layout.svelte` — dark surface for every page
- `src/routes/+page.svelte`, `src/routes/login/+page.svelte`,
  `src/routes/register/+page.svelte`, `src/routes/profile/+page.svelte` — landing and
  auth pages, rendering `<ZitadelLogin>` and `<ZitadelSession>` from `@zitadel/sdk-svelte`
  on the client only
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`)
- `package.json` — adds `@zitadel/sdk-sveltekit` and `@zitadel/sdk-svelte`, and pins the
  dev script to the registered port with `--strictPort` (an edit eject cannot revert)
- `vite.config.*` — adds the `zitadel()` plugin from `@zitadel/sdk-sveltekit/vite` after
  `sveltekit()` (infrastructure; an edit eject cannot revert)

## How the proxy works

The hook passes only the route policy: `@zitadel/sdk-sveltekit` reads `ZITADEL_URL` and
`ZITADEL_PROJECT_SECRET` from `process.env` (SvelteKit's `$env` modules differ across major
versions). SvelteKit never puts env files on `process.env`, so in dev the `zitadel()` Vite
plugin does, as Next.js and Nitro do on their own; in production the platform sets them. The
generated hook names no Node global, so the app type-checks without `@types/node`. There is no
dev-only proxy, so it works the same in production.
