# Angular patcher

Integrates Zitadel auth into an Angular app.

The detector requires `@angular/core` 17 or newer; older versions are refused.

## What it patches

- `src/app/app.ts`, `src/app/app.html` — root component that renders the Zitadel widgets;
  `app.ts` imports its project id from `src/app/zitadel-project.ts`
- `zitadel-ng.cjs` — the launcher the serve, build and test scripts run through
- `src/app/zitadel-project.ts` — written once by setup and kept current by the
  launcher; git-ignored (`.gitignore` gets the rule), and removed whole by eject
- `src/app/app.routes.ts` — auth routes (`angular-routes.ts`; doctor verifies this wiring)
- `proxy.conf.cjs` — dev-server proxy
- `angular.json` — wires `proxyConfig` into the `serve` target
- `package.json` — adds `@zitadel/sdk-angular`; after the plan, `patch` runs
  each plain `ng serve|build|test …` script through `zitadel-ng.cjs` and adds a
  `dev` script (`node zitadel-ng.cjs serve`) when there is none. Setup refuses
  an app with a script that serves, builds or tests it in another form.

## How the client gets its project id

Angular's CLI reads no environment into client code, and `define` in
`angular.json` takes only literals. `zitadel-ng.cjs` loads `.env.local` with
Node's `process.loadEnvFile` (Node.js 20.12 or newer), which leaves a value the
environment already sets, writes the id into `src/app/zitadel-project.ts` when
the file does not already hold it, and runs the Angular CLI in its own process
with the arguments unchanged. So no managed file names a project, and the
client and the dev proxy read the same variable. A plain `ng` command on a
clean checkout fails to compile, the module missing; after an `npm run`, it
reuses the id that run wrote.

The script edits are not in the plan, so a repair never makes them: an app an
earlier CLI set up names its project in `app.ts`, runs `ng`, and builds without
an id, which the launcher would refuse. The repair writes neither `app.ts` nor
the launcher into such an app; when it runs there, it does replay the module
edit and the ignore rule, which add the git-ignored module the app never
imports.

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
