# apps/cloud

The deployment wrapper that runs `main` as a hosted, production-like cloud on
Vercel with PlanetScale Postgres in Frankfurt. Every merge to `main` deploys
to production; every other branch gets a preview with a database of its own,
except the Changesets version PR's `changeset-release/*` branch and the merge
queue's `gh-readonly-queue/**` branches.

The repo-root [`vercel.json`](../../vercel.json) defines the Vercel
deployment as seven [services](https://vercel.com/docs/services):

| Service | Root | What it is | Paths |
|---|---|---|---|
| `server` | `apps/cloud` | the Go server behind a Node.js wrapper ([`server/`](server/)) that hands its spans to Vercel Tracing, its metrics to Vercel custom metrics and its log lines to Vercel's logs, console off and left out of the build (`-tags noconsole`) | `/api/*`, the API; its own root paths, `/console/runtime.json` among them; until 1.0.0 the API's root paths |
| `console` | `apps/console` | the console SPA, built for `/console/` with Vercel Web Analytics and Speed Insights | `/console/*` |
| `docs` | `apps/docs` | the docs site, Fumadocs on Next.js, with Vercel Web Analytics and Speed Insights | `/docs`, `/docs/*` |
| `website` | `apps/website` | the front page and the changelog, on Next.js, with Vercel Web Analytics and Speed Insights | `/`, `/changelog`, `/changelog/*`, `/llms.txt`, `/_next/*`, `/favicon.ico`, `/favicons/*` |
| `cloud-functions` | `apps/cloud-functions` | the hosted cloud's backend on Next.js: the console add-on's calls, BotID's check in front of the sign-in widget, Stripe's webhooks and the workflows ([ADR 084](../../docs/adrs/084-hosted-cloud-business-systems.md)) | `/cloud/*` |
| `schemas` | `apps/cloud` | the built-in schemas, static files that [`scripts/render-builtin-schemas.mjs`](../../scripts/render-builtin-schemas.mjs) renders from the server's embedded copies | `/schemas/v1/*` |
| `go-import` | `apps/cloud/go-import` | one static page, Go's vanity-import metadata for the client module (the runbook's [Go import path](../../docs/runbooks/cloud.md#go-import-path)) | every path on the host `go.zitadel.com` |

The API lives under `/api/v1`
([ADR 077](../../docs/adrs/077-api-path-prefix.md)): the first rewrite sends
`/api/*` to the server, so no other service can take a path there. Until
1.0.0 the server also answers the API's root paths, with a `Deprecation`
header, through one rule that names the API's resources. Apart from those and
its own root paths, nothing reaches the server: every other path is the
website's.

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
the document whose `$id` is that URL, while the API keeps
`/api/v1/schemas` and `/api/v1/schemas/{schema_id}`, and until 1.0.0 `/schemas` and
`/schemas/{schema_id}` (the runbook's
[Built-in schemas](../../docs/runbooks/cloud.md#built-in-schemas)).

The services install and build from `vercel.json` itself. The install
leaves out the other platforms' native packages, so Vercel's build cache
stays under its size limit, and pnpm skips it once a service built earlier
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
The `server` service is a Node.js function: Vercel adds spans to a request's
trace only from a Node.js function, so [`server/index.mjs`](server/index.mjs)
starts the launcher on loopback, forwards every request to it with Vercel's
own `traceparent`, and hands the server's spans and metrics to Vercel. Its build command
puts Go on PATH ([`install-go.sh`](install-go.sh)), which Vercel's Node.js
build image lacks, and runs `deploy`, which turbo orders after `build` (the
launcher) and `migrate`; the function ships the launcher through its
`includeFiles`. None of the three is cached: the launcher runs with
the deployment's secrets, and any branch's build can write the team's cache.
`migrate` sees the deployment's whole environment. The `schemas` service
runs `schemas` and is rooted here, where `package.json` has no
framework dependencies, so Vercel detects no framework (a service takes no
`framework: null`); a framework dependency in it would change how that
service builds. The launcher's Go tests run in the server's `test`.

| File | Role |
|---|---|
| [`../api/cmd/cloud-launcher/`](../api/cmd/cloud-launcher/) | the function binary, a package of the Go module: maps `CLOUD_DATABASE_URL` / `CLOUD_MIGRATOR_DATABASE_URL`, the master key, `CRON_SECRET` (the token of the cron job that purges expired audit events), Vercel's `PORT` and its `x-vercel-id` request ID onto the server's configuration; at build time it creates a preview's database, checks the function's configuration and migrates; `drop-preview` drops a merged branch's database, or every idle one |
| [`build-launcher.sh`](build-launcher.sh) | the `build` task: compiles the launcher, without the console, into `dist/nextgen-launcher`; it stamps in the branch, which picks a preview's database |
| [`deploy.sh`](deploy.sh) | the `deploy` task, last in the `server` service's build: checks that the migrated launcher is in `dist/`, where the function ships it from |
| [`server/`](server/) | the `server` service's function: starts the launcher, forwards requests to it and prints its log lines at their level and under their request ([`logs.mjs`](server/logs.mjs)). While Vercel is the telemetry sink ([`sink.mjs`](server/sink.mjs)), it takes the server's OTLP exports on a loopback collector ([`collector.mjs`](server/collector.mjs)), decodes them ([`otlp.mjs`](server/otlp.mjs)), hands each request's spans ([`spans.mjs`](server/spans.mjs)) to Vercel Tracing and sends the metrics its list names ([`metrics.mjs`](server/metrics.mjs)) as Vercel custom metrics |
| [`install-go.sh`](install-go.sh) | puts the Go toolchain `apps/api/go.mod` names on PATH in the `server` service's build, once its SHA-256 matches the one go.dev lists |
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
