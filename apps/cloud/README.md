# apps/cloud

The deployment wrapper that runs `main` as a hosted, production-like cloud on
Vercel with PlanetScale Postgres in Frankfurt. Every merge to `main` deploys
to production; every other branch gets a preview with a database of its own,
except the Changesets version PR's `changeset-release/*` branch and the merge
queue's `gh-readonly-queue/**` branches.

The repo-root [`vercel.json`](../../vercel.json) defines the Vercel
deployment as six [services](https://vercel.com/docs/services):

| Service | Root | What it is | Paths |
|---|---|---|---|
| `server` | `.` | the Go server on Vercel's Go preset, login UI embedded, console off and left out of the build (`-tags noconsole`) | everything else, including `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built for `/console/` with Vercel Web Analytics and Speed Insights | `/console/*` |
| `storybook` | `apps/storybook` | the component workbench, a static build | `/storybook/*` |
| `docs` | `apps/docs` | the docs site, Fumadocs on Next.js, with Vercel Web Analytics and Speed Insights | `/docs`, `/docs/*` |
| `website` | `apps/website` | the front page and the changelog, on Next.js, with Vercel Web Analytics and Speed Insights | `/`, `/changelog`, `/llms.txt`, `/_next/*`, `/favicon.ico`, `/favicons/*` |
| `schemas` | `apps/cloud` | the built-in schemas, static files that [`scripts/render-builtin-schemas.mjs`](../../scripts/render-builtin-schemas.mjs) renders from the server's embedded copies | `/schemas/v1/*` |

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
([`apps/website/AGENTS.md`](../website/AGENTS.md)). The `schemas` service
publishes the built-in schemas the server names under
`https://zitadel.com/schemas/v1`: `/schemas/v1/user-schema.json` answers with
the document whose `$id` is that URL, while the API keeps `/schemas` and
`/schemas/{id}` (the runbook's
[Built-in schemas](../../docs/runbooks/cloud.md#built-in-schemas)).

The services install and build from `vercel.json` itself. The install
leaves out the other platforms' native packages, so Vercel's build cache
stays under its 1.5 GB limit, and pnpm skips it once a service built earlier
in the deployment has installed (`--optimistic-repeat-install`). The console
and the storybook build with `turbo run build`, which reads and writes the
team's remote cache as Vercel sets it up; the docs and the website run their
own `pnpm run build`, the website after `@zitadel/components` has built
through turbo, since its showcase renders the package's atoms. The schemas
need no install: their build is one Node script, and the service is rooted
here, where no `package.json` makes Vercel detect a framework.

| File | Role |
|---|---|
| [`launcher/`](launcher/) | the function binary: maps `CLOUD_DATABASE_URL` / `CLOUD_MIGRATOR_DATABASE_URL`, the master key, Vercel's `PORT` and its `x-vercel-id` request ID onto the server's configuration; at build time it creates a preview's database, checks the function's configuration and migrates |
| [`build.sh`](build.sh) | the `server` service's build: login UI, launcher, migrations |
| [`setup-secrets.sh`](setup-secrets.sh) | mints an environment's master key and root admin (with [`admin-document.mjs`](admin-document.mjs)) and sets them on the Vercel project; the originals go to 1Password |

`pnpm run cloud` runs the same services on http://localhost:3000 with
`vercel dev`, the server on SQLite and a throwaway master key
([`scripts/run-cloud.mjs`](../../scripts/run-cloud.mjs); the runbook's
[Running the cloud locally](../../docs/runbooks/cloud.md#running-the-cloud-locally)).

Every deployment is tested once it is built:
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs the services'
contract suites against the deployment's URL (the runbook's
[Deployment checks](../../docs/runbooks/cloud.md#deployment-checks)).

Setup, configuration and operations: [the runbook](../../docs/runbooks/cloud.md).
