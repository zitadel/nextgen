# SolidStart patcher

Integrates Zitadel auth into a SolidStart app. Like Next and Nuxt, SolidStart proxies and
verifies the session server-side — here through the `createNextgenMiddleware` middleware
from `@zitadel/sdk-solid-start`.

The detector requires `solid-js` and `@solidjs/start` 2 or newer. SolidStart 1 registers
middleware in `app.config.ts` and has no `vite.config`, so it is refused.

## What it patches

- `src/middleware.ts` — the middleware (infrastructure): proxies `/__nextgen/*`, verifies
  the session, and redirects unauthenticated requests for `/profile` to `/login`
- `vite.config.*` — registers it as `solidStart({ middleware: "./src/middleware.ts" })`
  (infrastructure; edits the first matching `vite.config.{ts,mts,js,mjs}`, is idempotent,
  and fails with a validation error if there is no `solidStart(` call or its argument is not
  an object)
- `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/register.tsx`,
  `src/routes/profile.tsx` — landing and auth pages, rendering `<ZitadelLogin>` and
  `<ZitadelSession>` from `@zitadel/sdk-solid` through `clientOnly`, because the widget
  registers custom elements at import time and would crash the server render
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`)
- `package.json` — adds `@zitadel/sdk-solid-start` and `@zitadel/sdk-solid`, and pins the
  dev script to the registered port with `--strictPort` (an edit eject cannot revert)

## How the proxy works

The middleware is wrapped in SolidStart's own `createMiddleware` and takes `url` and
`projectSecret` from `process.env`. There is no dev-only proxy, so it works the same in
production.
