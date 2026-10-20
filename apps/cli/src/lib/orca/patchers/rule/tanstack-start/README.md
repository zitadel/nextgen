# TanStack Start patcher

Integrates Zitadel auth into a TanStack Start app (React). Like Next and Nuxt, TanStack
Start proxies and verifies the session server-side — here through the
`createNextgenRequestMiddleware` request middleware from `@zitadel/sdk-tanstack-start`.

The detector requires `react` and `@tanstack/react-start` 1.168.10 or newer. It runs before the
React detector, which excludes `@tanstack/react-start`.

## What it patches

- `src/start.ts` — the start entry (infrastructure): registers the auth request middleware,
  which proxies `/__nextgen/*`, verifies the session, and redirects unauthenticated
  requests for `/profile` to `/login`. It also lists `createCsrfMiddleware` first, because
  writing this file opts out of TanStack Start's default CSRF protection for server functions
- `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/register.tsx`,
  `src/routes/profile.tsx` — landing and auth routes, rendering the typed `<ZitadelLogin>`
  and `<ZitadelSession>` wrappers from `@zitadel/sdk-tanstack-start/react`. The profile
  route also guards itself in `beforeLoad` through a server function, since client-side
  navigation never reaches the request middleware
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`)
- `package.json` — adds `@zitadel/sdk-tanstack-start` (and nothing else from `@zitadel/*`),
  and pins the dev script to the registered port with `--strictPort` (an edit eject cannot revert)

No config file is edited: the start entry is a plain file, so every managed file carries
the marker.

## How the proxy works

The middleware takes `url` and `projectSecret` from `process.env`. There is no dev-only
proxy, so it works the same in production.
