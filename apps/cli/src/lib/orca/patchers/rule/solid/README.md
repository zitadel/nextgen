# Solid patcher

Integrates Zitadel auth into a Vite + Solid single-page app.

## What it patches

- `src/App.tsx` — auth entry that renders the Zitadel login/logout widgets
- `vite.config.*` — merges the `/__nextgen` dev-server proxy into the first
  matching `vite.config.{ts,mts,js,mjs}`
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID` (client-exposed), plus
  the shared `ZITADEL_*` keys the base patcher writes (`ZITADEL_PROJECT_ID`,
  `ZITADEL_PROJECT_SECRET`, `ZITADEL_ISSUER`, `ZITADEL_URL`,
  `ZITADEL_ENVIRONMENT`) — the dev proxy reads `ZITADEL_PROJECT_SECRET`
- `package.json` — adds `@zitadel/sdk-solid`

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, the Vite proxy forwards
those to the backend and attaches the project service-key secret (read from
`ZITADEL_PROJECT_SECRET`) only to `POST /sessions/exchange`. Production needs
`@zitadel/edge-proxy` in front.
