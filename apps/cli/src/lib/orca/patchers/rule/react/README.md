# React patcher

Integrates Zitadel auth into a Vite + React single-page app.

## What it patches

- `src/App.tsx` — auth entry that renders the Zitadel login/logout widgets
- `vite.config.ts` — merges the `/__nextgen` dev-server proxy
- `.env.example`, `.env.local` — `VITE_ZITADEL_PROJECT_ID`
- `package.json` — adds `@zitadel/sdk-react`

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, the Vite proxy forwards
those to the backend and injects the project service-key on
`/sessions/exchange`. Production needs `@zitadel/edge-proxy` in front.
