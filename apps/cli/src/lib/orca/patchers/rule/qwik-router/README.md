# Qwik Router patcher

Integrates Zitadel auth into a Qwik Router app on Qwik 2. Like Next and Nuxt, Qwik Router
proxies and verifies the session server-side — here through the `createNextgenOnRequest`
plugin from `@zitadel/sdk-qwik-router`.

The detector requires `@qwik.dev/core` and `@qwik.dev/router` at `2.0.0-beta.45` or newer.
A Qwik 1 app (`@builder.io/qwik-city`) is not matched, because the `@zitadel/sdk-qwik`
widgets need Qwik 2.

## What it patches

- `src/routes/plugin@nextgen.ts` — the root `onRequest` plugin (infrastructure): proxies
  `/__nextgen/*`, verifies the session, and redirects unauthenticated requests for
  `/profile` to `/login`
- `src/routes/index.tsx`, `src/routes/login/index.tsx`, `src/routes/register/index.tsx`,
  `src/routes/profile/index.tsx` — landing and auth pages, rendering `<ZitadelLogin>` and
  `<ZitadelSession>` from `@zitadel/sdk-qwik`
- `.env.example`, `.env.local` — `PUBLIC_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`)
- `package.json` — adds `@zitadel/sdk-qwik-router` and `@zitadel/sdk-qwik` as
  `devDependencies` (Qwik bundles those into the server build; the writer moves an existing
  `dependencies` entry rather than listing a package twice), and pins the dev script to the
  registered port with `--strictPort` (an edit eject cannot revert)

No config file is edited: the plugin is a plain route file, so every managed file carries
the marker.

## How the proxy works

The plugin reads `url` and `projectSecret` per request from Qwik Router's `ev.env`, which
carries `.env.local`. There is no dev-only proxy, so it works the same in production.
