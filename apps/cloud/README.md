# apps/cloud

The deployment wrapper that runs `main` as a hosted, production-like cloud on
Vercel with a Neon Postgres database in Frankfurt. Every merge to `main`
deploys to production; every pull request that touches the server, the
console or the login UI gets a preview with its own Neon branch.

The repo-root [`vercel.json`](../../vercel.json) defines the Vercel
deployment as two [services](https://vercel.com/docs/services):

| Service | Root | What it is | Paths |
|---|---|---|---|
| `server` | `.` | the Go server on Vercel's Go preset, login UI embedded, console off | everything else, including `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built with Vercel Web Analytics and Speed Insights | `/ui/console/*` |

The console is served at the path the server would serve it from, on the same
origin, so the session cookie, CSRF and the server's console links work
unchanged.

| File | Role |
|---|---|
| [`launcher/`](launcher/) | the function binary: maps Neon's `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, the master key and Vercel's `PORT` onto the server's configuration, and runs `migrate` at build time |
| [`build.sh`](build.sh) | the `server` service's build: login UI, launcher, migrations |
| [`ignore-build.sh`](ignore-build.sh) | the Ignored Build Step: production always deploys, a preview only when its branch touches what the deployment runs |

Setup, configuration and operations: [the runbook](../../docs/runbooks/cloud.md).
