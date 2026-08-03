# Angular patcher

Integrates Zitadel auth into an Angular app.

## What it patches

- `src/app/app.ts`, `src/app/app.html` — root component that renders the Zitadel widgets
- `proxy.conf.cjs` — dev-server proxy
- `angular.json` — wires `proxyConfig` into the `serve` target
- `package.json` — adds `@zitadel/sdk-angular`, and a `dev` script (`ng serve`)
  when the project doesn't already define one

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, `proxy.conf.cjs`
forwards those to the backend and attaches the project service-key secret (read
from `ZITADEL_PROJECT_SECRET` in `.env.local`) only to `POST /sessions/exchange`.
Production needs `@zitadel/edge-proxy` in front.
