# Angular patcher

Integrates Zitadel auth into an Angular app.

The detector requires `@angular/core` 17 or newer; older versions are refused.

## What it patches

- `src/app/app.ts`, `src/app/app.html` — root component that renders the Zitadel widgets;
  `app.ts` reads its project id from `ZITADEL_PROJECT_ID`, which `zitadel-ng.cjs` defines
- `src/app/app.routes.ts` — auth routes (`angular-routes.ts`; doctor verifies this wiring)
- `proxy.conf.cjs` — dev-server proxy
- `angular.json` — wires `proxyConfig` into the `serve` target, and defines
  `ZITADEL_PROJECT_ID` there and in the build's `production` configuration as a
  message, so a plain `ng serve` or `ng build` stops saying what to run
- `zitadel-ng.cjs` — the launcher the `ng serve` and `ng build` scripts run through
- `package.json` — adds `@zitadel/sdk-angular`, runs the serve and build scripts
  that are still as `ng new` or an earlier setup wrote them through
  `zitadel-ng.cjs`, and adds a `dev` script (`node zitadel-ng.cjs serve`) when
  the project doesn't already define one

## How the client gets its project id

Angular's CLI reads no environment into client code, and `define` in
`angular.json` takes only literals. `zitadel-ng.cjs` loads `.env.local` with
Node's `process.loadEnvFile`, which leaves a value the environment already sets,
and runs the Angular CLI in its own process with
`--define ZITADEL_PROJECT_ID="…"`, which replaces the message `angular.json`
defines. So no managed file names a project, and the client and the dev proxy
read the same variable. A serve or build script the developer changed is not
moved; the doctor names it. `ng test` builds with the `development`
configuration, which defines nothing, so `app.ts` falls back to an empty id
there, and the login widget says it has none.

## How the proxy works

The SDK widgets call `/__nextgen/*` same-origin. In dev, `proxy.conf.cjs`
forwards those to the backend and attaches the project service-key secret (read
from `ZITADEL_PROJECT_SECRET` in `.env.local`) only to `POST /sessions/exchange`.
It addresses the backend by its own host name (`changeOrigin`), as a remote
https server requires, and passes the app's origin on in `X-Forwarded-Host` and
`X-Forwarded-Proto` (`xfwd`). It keeps the app's session in a cookie named after
its project (`ZITADEL_PROJECT_ID`), so the app and the Console of a local server
don't sign each other out on `localhost`
(`docs/adrs/073-session-cookie-per-project.md`,
`docs/adrs/083-session-cookie-host-prefix.md`).
The production story is a platform rewrite plus the publishable key from ADR 036
(`docs/adrs/036-api-credential-planes.md`), tracked in issue #560.
