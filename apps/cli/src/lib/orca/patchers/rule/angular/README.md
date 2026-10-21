# Angular patcher

Integrates Zitadel auth into an Angular app.

The detector requires `@angular/core` 17 or newer; older versions are refused.

## What it patches

- `src/app/app.ts`, `src/app/app.html` — root component that renders the Zitadel widgets
- `src/app/app.routes.ts` — auth routes (`angular-routes.ts`; doctor verifies this wiring)
- `proxy.conf.cjs` — dev-server proxy
- `angular.json` — wires `proxyConfig` into the `serve` target
- `package.json` — adds `@zitadel/sdk-angular`, and a `dev` script (`ng serve`)
  when the project doesn't already define one

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, `proxy.conf.cjs`
forwards those to the backend and attaches the project service-key secret (read
from `ZITADEL_PROJECT_SECRET` in `.env.local`) only to `POST /sessions/exchange`.
It addresses the backend by its own host name (`changeOrigin`), as a remote
https server requires, and passes the app's origin on in `X-Forwarded-Host` and
`X-Forwarded-Proto` (`xfwd`). It keeps the app's session in a cookie named after
its project (`ZITADEL_PROJECT_ID`), so the app and the Console of a local server
don't sign each other out on `localhost`
(`docs/adrs/073-session-cookie-per-project.md`).
The production story is a platform rewrite plus the publishable key from ADR 036
(`docs/adrs/036-api-credential-planes.md`), tracked in issue #560.
