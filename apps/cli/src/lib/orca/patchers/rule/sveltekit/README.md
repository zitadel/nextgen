# SvelteKit patcher

Integrates Zitadel auth into a SvelteKit app. Like Next and Nuxt, SvelteKit proxies and
verifies the session server-side — here through the `createNextgenHandle` hook from
`@zitadel/sdk-sveltekit`.

The detector requires `@sveltejs/kit` 3 or newer (for `$app/env/private`) and `svelte` 5 or newer (the widgets come
from `@zitadel/sdk-svelte`, which is written with runes); older versions are refused.

## What it patches

- `src/hooks.server.ts` — the server hook (infrastructure): proxies `/__nextgen/*`,
  verifies the session, and redirects unauthenticated requests for `/profile` to `/login`
- `src/env.ts` (or an existing `src/env.js`) — declares `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET`
  and `ZITADEL_PROJECT_ID` for `$app/env/private`: written where the app has none, and
  merged into the app's own `defineEnvVars({ ... })` call otherwise. Unmarked, since the
  app declares its own variables there too; doctor checks the three entries as
  infrastructure wiring, and eject lists them as a manual cleanup step
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

No config file is edited: the hook is a plain file, so every managed file carries the marker.

## How the proxy works

The hook imports `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET` and `ZITADEL_PROJECT_ID` from
`$app/env/private`, which SvelteKit fills from `.env.local` in dev and from the platform's
environment in production, answers with an error naming any that is missing, and never bundles for the browser. The
hook names no Node global, so the app type-checks without `@types/node`. There is no
dev-only proxy, so it works the same in production.
