# Next.js patcher

Integrates Zitadel auth into a Next.js App Router app. The page and provider
templates come from the chosen renderer — `react` today; the `web-component`
renderer id is declared in `renderers/registry.ts` but deliberately
unavailable (`status: "not-implemented"`, reserved for a future
`@zitadel/ui-lit`).

## What it patches

- `<appDir>/login/page.tsx`, `<appDir>/register/page.tsx` — auth routes
- `<appDir>/profile/page.tsx` — profile route (renderer-dependent)
- `middleware.ts` — runs `nextgenMiddleware`; on Next 16+ the file is
  `proxy.ts` instead, and the patcher handles the migration conflict when
  both exist
- renderer extras — a provider component and/or `custom-elements.d.ts`
- `package.json` — adds the renderer's SDK (e.g. `@zitadel/sdk-next`)

## How the proxy works

The middleware file (`middleware.ts`, or `proxy.ts` on Next 16+) runs
`nextgenMiddleware` server-side: it proxies `/__nextgen/*` to `ZITADEL_URL`
and gates `/profile`. There is no dev-only proxy, so it works the same in
production.
