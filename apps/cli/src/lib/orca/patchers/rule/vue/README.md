# Vue patcher

Integrates Zitadel auth into a Vite + Vue single-page app.

The detector requires `vue` 3.2 or newer; older versions are refused.

## What it patches

- `src/App.vue` — auth entry that renders the Zitadel login/logout widgets
- `vite.config.*` — merges the `/__nextgen` dev-server proxy into the first
  matching `vite.config.{ts,mts,js,mjs}`
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`) — the dev proxy reads `ZITADEL_PROJECT_SECRET`
- `package.json` — adds `@zitadel/sdk-vue`

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, the Vite proxy forwards
those to the backend and attaches the project service-key secret (read from
`ZITADEL_PROJECT_SECRET`) only to `POST /sessions/exchange`. It keeps the app's
session in a cookie named after its project (`ZITADEL_PROJECT_ID`), so the app
and the Console of a local server don't sign each other out on `localhost`
(`docs/adrs/073-session-cookie-per-project.md`). The production
story is a platform rewrite plus the publishable key from ADR 036
(`docs/adrs/036-api-credential-planes.md`), tracked in issue #560.
