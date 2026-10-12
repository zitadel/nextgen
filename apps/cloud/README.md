# apps/cloud

The deployment wrapper that runs `main` as a hosted, production-like cloud on
Vercel with PlanetScale Postgres in Frankfurt. Every merge to `main` deploys
to production; every other branch gets a preview with a database of its own.

The repo-root [`vercel.json`](../../vercel.json) defines the Vercel
deployment as four [services](https://vercel.com/docs/services):

| Service | Root | What it is | Paths |
|---|---|---|---|
| `server` | `.` | the Go server on Vercel's Go preset, login UI embedded, console off | everything else, including `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built with Vercel Web Analytics and Speed Insights | `/ui/console/*` |
| `storybook` | `apps/storybook` | the component workbench, a static build | `/storybook/*` |
| `docs` | `apps/docs` | the docs site, Fumadocs on Next.js, with Vercel Web Analytics and Speed Insights | `/docs`, `/docs/*` |

The console is served at the path the server would serve it from, on the same
origin, so the session cookie, CSRF and the server's console links work
unchanged. Everything the docs serve, their scripts and their search, lives
under `/docs` ([`apps/docs/AGENTS.md`](../docs/AGENTS.md)).

| File | Role |
|---|---|
| [`launcher/`](launcher/) | the function binary: maps `CLOUD_DATABASE_URL` / `CLOUD_MIGRATOR_DATABASE_URL`, the master key and Vercel's `PORT` onto the server's configuration; at build time it creates a preview's database, checks the function's configuration and migrates |
| [`build.sh`](build.sh) | the `server` service's build: login UI, launcher, migrations |
| [`setup-secrets.sh`](setup-secrets.sh) | mints an environment's master key and root admin (with [`admin-document.mjs`](admin-document.mjs)) and sets them on the Vercel project; the originals go to 1Password |

Setup, configuration and operations: [the runbook](../../docs/runbooks/cloud.md).
