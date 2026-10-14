# apps/cloud

The deployment wrapper that runs `main` as a hosted, production-like cloud on
Vercel with PlanetScale Postgres in Frankfurt. Every merge to `main` deploys
to production; every other branch gets a preview with a database of its own,
except the Changesets version PR's `changeset-release/*` branch and the merge
queue's `gh-readonly-queue/**` branches.

The repo-root [`vercel.json`](../../vercel.json) defines the Vercel
deployment as five [services](https://vercel.com/docs/services):

| Service | Root | What it is | Paths |
|---|---|---|---|
| `server` | `.` | the Go server on Vercel's Go preset, login UI embedded, console off | everything else, including `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built for `/console/` with Vercel Web Analytics and Speed Insights | `/console/*` |
| `storybook` | `apps/storybook` | the component workbench, a static build | `/storybook/*` |
| `docs` | `apps/docs` | the docs site, Fumadocs on Next.js, with Vercel Web Analytics and Speed Insights | `/docs`, `/docs/*` |
| `website` | `apps/website` | the coming-soon page, on Next.js, with Vercel Web Analytics and Speed Insights | `/`, `/_next/*`, `/favicon.ico`, `/favicons/*` |

The console is served on the same origin, so the session cookie and CSRF work
unchanged, but at `/console/` rather than a self-hosted server's
`/ui/console/`: its build takes the path from `CONSOLE_BASE_PATH`, and the
launcher points the server's console links (claim, dashboard) there. The
server's `/console/runtime.json` keeps its own rewrite, ahead of the
console's, and old `/ui/console/*` links redirect to `/console/*` (307, query
kept). Everything the docs serve, their scripts and their search, lives
under `/docs` ([`apps/docs/AGENTS.md`](../docs/AGENTS.md)). The website's
scripts, styles and fonts load from `/_next/`; a page of its own beyond `/`
needs a rewrite of its own. Its favicons are the host's: the console, the
login UI and the docs link the same set at `/favicons/`
([`apps/website/AGENTS.md`](../website/AGENTS.md)).

| File | Role |
|---|---|
| [`launcher/`](launcher/) | the function binary: maps `CLOUD_DATABASE_URL` / `CLOUD_MIGRATOR_DATABASE_URL`, the master key and Vercel's `PORT` onto the server's configuration; at build time it creates a preview's database, checks the function's configuration and migrates |
| [`install.sh`](install.sh) | every service's install: the workspace's packages, native ones only for the build machine, so Vercel's build cache stays under its 1.5 GB limit; it runs once per deployment, and the services built after the first one skip it |
| [`build.sh`](build.sh) | the `server` service's build: login UI, launcher, migrations |
| [`turbo-build.sh`](turbo-build.sh) | the console's, the storybook's and the login UI's builds with turbo, using the team's remote cache as Vercel sets it up: every build reads and writes it, production and previews in separate entries |
| [`setup-secrets.sh`](setup-secrets.sh) | mints an environment's master key and root admin (with [`admin-document.mjs`](admin-document.mjs)) and sets them on the Vercel project; the originals go to 1Password |

Every deployment is tested once it is built:
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs the services'
contract suites against the deployment's URL (the runbook's
[Deployment checks](../../docs/runbooks/cloud.md#deployment-checks)).

Setup, configuration and operations: [the runbook](../../docs/runbooks/cloud.md).
