# Angular patcher

Integrates Zitadel auth into an Angular app.

## What it patches

- `src/app/app.ts`, `src/app/app.html` — root component that renders the Zitadel widgets
- `proxy.conf.cjs` — dev-server proxy
- `angular.json` — wires `proxyConfig` into the `serve` target
- `package.json` — adds `@zitadel/sdk-angular`

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, `proxy.conf.cjs`
forwards those to the backend and injects the project service-key on
`/sessions/exchange`. Production needs `@zitadel/edge-proxy` in front.
