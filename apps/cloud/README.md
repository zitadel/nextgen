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
| `server` | `.` | the Go server on Vercel's Go preset, console off and left out of the build (`-tags noconsole`) | everything else, including `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built for `/console/` with Vercel Web Analytics and Speed Insights | `/console/*` |
| `docs` | `apps/docs` | the docs site, Fumadocs on Next.js, with Vercel Web Analytics and Speed Insights | `/docs`, `/docs/*` |
| `website` | `apps/website` | the front page and the changelog, on Next.js, with Vercel Web Analytics and Speed Insights | `/`, `/changelog`, `/changelog/*`, `/llms.txt`, `/_next/*`, `/favicon.ico`, `/favicons/*` |
| `cloud-functions` | `apps/cloud-functions` | the hosted cloud's backend on Next.js: the console add-on's calls, BotID's check in front of the sign-in widget, Stripe's webhooks and the workflows ([ADR 083](../../docs/adrs/083-hosted-cloud-business-systems.md)) | `/cloud/*` |
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
needs a rewrite of its own. Its favicons are the host's: the console and the
docs link the same set at `/favicons/`
([`apps/website/AGENTS.md`](../website/AGENTS.md)). The `schemas` service
publishes the built-in schemas the server names under
`https://zitadel.com/schemas/v1`: `/schemas/v1/user-schema.json` answers with
the document whose `$id` is that URL, while the API keeps `/schemas` and
`/schemas/{id}` (the runbook's
[Built-in schemas](../../docs/runbooks/cloud.md#built-in-schemas)).

The services install and build from `vercel.json` itself. The install
leaves out the other platforms' native packages, so Vercel's build cache
stays under its 1.5 GB limit, and pnpm skips it once a service built earlier
in the deployment has installed (`--optimistic-repeat-install`). Every
service builds through turbo, so CI and the deployments share one task graph
and the team's remote cache, which each build reads and writes as Vercel
sets it up. The console runs `turbo run build`; the docs and the website run
`turbo run build --filter=…`, which builds the packages they render first:
the website's showcase the atoms of `@zitadel/components`, the docs' live
examples the same package, `@zitadel/api-mock` and the `@zitadel/api` client
the mock calls. Their own builds never come from the cache: Skew Protection
bakes the deployment's ID into a Next.js build, and their keys hold it.

This folder is the package `@zitadel/cloud`, whose tasks
([`turbo.json`](turbo.json)) build the `server` and `schemas` services.
The `server` service's build command installs, since the Go preset runs no
`installCommand`, and runs `deploy`, which turbo orders after `build` (the
launcher) and `migrate`. None of the three is cached: the launcher runs with
the deployment's secrets, and any branch's build can write the team's cache.
`migrate` sees the deployment's whole environment. The `schemas` service
runs `schemas` and is rooted here, where `package.json` has no
dependencies, so Vercel detects no framework (a service takes no
`framework: null`); a framework dependency in it would change how that
service builds. Moon has no project for the package: the launcher's Go
tests run in the server's `test`.

| File | Role |
|---|---|
| [`launcher/`](launcher/) | the function binary: maps `CLOUD_DATABASE_URL` / `CLOUD_MIGRATOR_DATABASE_URL`, the master key, `CRON_SECRET` (the token of the cron job that purges expired audit events), Vercel's `PORT` and its `x-vercel-id` request ID onto the server's configuration; at build time it creates a preview's database, checks the function's configuration and migrates; `drop-preview` drops a merged branch's database, or every idle one |
| [`build-launcher.sh`](build-launcher.sh) | the `build` task: compiles the launcher, without the console, into `dist/nextgen-launcher`; it stamps in the branch, which picks a preview's database |
| [`deploy.sh`](deploy.sh) | the `deploy` task, last in the `server` service's build: copies the migrated launcher to `$VERCEL_OUTPUT_FILE` |
| [`setup-secrets.sh`](setup-secrets.sh) | mints an environment's master key and root admin (with [`admin-document.mjs`](admin-document.mjs)) and sets them on the Vercel project; the originals go to 1Password |

`pnpm run cloud` (turbo: this package's `dev`) runs the same services on
http://localhost:3000 with `vercel dev`, the server on SQLite and a
throwaway master key
([`scripts/run-cloud.mjs`](../../scripts/run-cloud.mjs); the runbook's
[Running the cloud locally](../../docs/runbooks/cloud.md#running-the-cloud-locally)).

Every deployment is tested once it is built:
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs the services'
contract suites against the deployment's URL (the runbook's
[Deployment checks](../../docs/runbooks/cloud.md#deployment-checks)).

Setup, configuration and operations: [the runbook](../../docs/runbooks/cloud.md).
