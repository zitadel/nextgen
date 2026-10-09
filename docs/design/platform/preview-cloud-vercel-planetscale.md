# Preview Cloud on Vercel + PlanetScale Postgres

> **Status:** Live (2026-10-08). Code: [`apps/cloud/`](../../../apps/cloud/),
> runbook: [preview-cloud.md](../../runbooks/preview-cloud.md).
> This note is the dated record of the research and the decisions, oldest
> first; where a later section disagrees with an earlier one, the later one
> holds. The first draft (2026-10-07) targeted Cloudflare Containers: a
> Worker router in front of one Durable Object per container replica, a
> manual replica count, a cold-start p95 around 24 s. It was dropped after
> the database tests, see "Decision" below; the database findings are what
> survived of it.
> **See also:** [Overview](overview.md) · [Claim Flow](claim-flow.md) ·
> [ADR 053](../../adrs/053-cross-project-principals.md) ·
> [ADR 065](../../adrs/065-background-jobs.md) ·
> [Operations example config](../../operations/nextgen.example.yaml)
>
> **Scope:** a hosted *preview* cloud for nextgen. Production stays on GCP
> (Spanner). Multi-region placement is explicitly deferred (see "Regions") and
> gated on a buyer for residency.

## Neki findings (2026-10-07, PS-10 unsharded, AWS eu-central-1, Postgres 18.6 Neki)

Tested with the published `@zitadel/server@1.0.0-alpha.24` binary and a
Node `pg` probe. Three blockers, all reported by the router, all on an
**unsharded** database:

| # | What | Effect on nextgen | Neki message |
|---|---|---|---|
| 1 | DDL inside `BEGIN … COMMIT` is accepted, invisible to the next statement, and gone after `COMMIT`. Same for the implicit transaction of a multi-statement simple query. Autocommit DDL works. | goose cannot create its version table; 25 of 26 migrations run in a transaction. Silent, no error. | none |
| 2 | Correlated subqueries with outer references | every `CheckAuthz` and every authz list predicate, so every authenticated call except project creation returns 500 | `NK013 not implemented: [110] correlated subquery with outer references that cannot be safely decorrelated is not yet supported` |
| 3 | Data-modifying CTEs (`WITH … INSERT … RETURNING`) | user create, auth-attempt create, and every other multi-insert CTE | `NK013 not implemented: [816] CTE containing DML body (INSERT) without verifiable write output columns cannot be executed on the router yet` |

Minor: `EXECUTE format(…)` inside a function body is refused (`42501`),
which only affects the planner-setting `DO` block at the end of the users
migration.

What works: TLS `verify-full` on 5432, `pg_advisory_lock`, savepoints,
`FOR UPDATE`, enum types, composite types, hash-partitioned tables, plpgsql
trigger functions, `CREATE EXTENSION btree_gin` / `pgcrypto`, serial
columns, plain inserts. With the migrations applied statement by statement
in autocommit, the server boots, `/readyz` is 200, anonymous project
creation with default seeding succeeds, bearer introspection works, and wide
events are written.

**Verdict:** not usable for nextgen in the current preview. The three
blockers are core shapes, and the first one is dangerous because it fails
silently. Every message says "yet", so re-test when PlanetScale announces
transactional DDL, correlated subqueries, and DML CTEs on the router.
Plain PlanetScale Postgres stays the database for this plan.

The goose workaround for #1 would be `goose.WithIsolateDDL()` plus
`-- +goose NO TRANSACTION` on every migration, which gives up atomic
migrations. Do not do that for Neki's sake alone.

## PlanetScale Postgres findings (2026-10-07, PS-5, AWS eu-central-1, Postgres 18.6)

Same binary and probes as the Neki run, against a plain PlanetScale Postgres
database on the direct port 5432.

- `nextgen migrate` applies all 27 migrations through goose unchanged.
- Server boots, `/readyz` 200, anonymous project creation with seeding,
  bearer introspection, `POST /users/query` (full authz check), `POST /users`
  (the multi-insert CTE), schema listing: all green.
- Raw probes: user-insert CTE, auth-attempt CTE with `LATERAL
  jsonb_to_recordset`, `FOR UPDATE`, savepoints, the full `CheckAuthz`
  statement with 33 bound arguments: all green.
- The database side of the plan is settled.

Latency, measured from a laptop on the US west coast, not from the platform:

| Measure | Value |
|---|---|
| TCP + TLS connect | ~4 s (first connection, includes DNS and handshake) |
| `SELECT 1` round trip | 151 ms |
| `nextgen migrate` (27 files) | 35 s |
| `POST /users/query` | 1.2 s |
| `POST /users` | 3.7 s |

A user create is roughly 20 database round trips, so request latency is
almost entirely RTT × round trips. That is the argument for running the
server next to the database: at a 5–15 ms server-to-database RTT the same
calls land in the 100–300 ms range, which the first Vercel deploy from
`fra1` confirmed.

Note for the API smoke: operator-plane calls carry `project_id` as a required
query parameter even when the bearer already names the project.

## Decision (2026-10-07): Vercel instead of Cloudflare Containers

After the database tests, the compute question was re-opened with Vercel
container images (Beta) in view. They won for the preview cloud:

| | Cloudflare Containers | Vercel container images |
|---|---|---|
| Routing | Worker + one Durable Object per replica, hand-built | one rewrite, built in |
| Scaling | manual replica count, no autoscaling | Fluid compute autoscaling, scale-to-zero after 5 min idle |
| Region | `WEUR` constraint, coarse | `fra1`, same metro as the PlanetScale database |
| Image source | Dockerfile that `FROM`s GHCR, pushed to Cloudflare's registry | `Dockerfile.vercel` that `FROM`s GHCR, built by Vercel |
| Config file for the master key | entrypoint layer, same trick | entrypoint layer, same trick |
| Migrations | CI before deploy | CI before deploy, Git deploys disabled to keep the order |
| Known limits | cold-start p95 ≈ 24 s, `Container` class EOL 2026-12 | 4.5 MB bodies, 300 s default duration, cold start unmeasured |
| Repo fit | new platform | already used by `apps/mock-zitadel` |

Two corrections to the plan above, found while implementing: this tree has
no background job loop yet (ADR 065 is still proposed), so the keep-warm cron
is only about cold starts; and `/readyz` does not check the database, it only
proves the HTTP server is listening, which happens after the pool opened.

Egress and latency from the platform were measured on the first Vercel
deploy, next section. The container image and the CI migration step of this
table were replaced later in the day (Go runtime, migrations in the build;
both below).

## First Vercel deploy (2026-10-07): numbers

Project `nextgen-preview-cloud` (team `zitadel`), production URL
`https://nextgen-preview-cloud.vercel.app`, functions in `fra1`, PlanetScale
Postgres PS-5 in AWS `eu-central-1`, image `ghcr.io/zitadel/nextgen:1.0.0-alpha.24`.

| Measure | Value |
|---|---|
| Build (buildah, GHCR pull + layer + push to VCR) | 13 s total, pull 2 s, push 3.5 s |
| Cold start, first request after idle (`/readyz`) | 3.7–5.3 s |
| Warm `/readyz` from the US west coast | 0.19 s |
| `POST /projects` (seeded) | 0.35 s |
| `POST /users` | 0.23 s (laptop → Frankfurt baseline was 3.7 s) |
| `POST /users/query` | 0.19 s |

The container-to-database hop is what mattered: the same user create is ~16×
faster from `fra1` than from a laptop. Cold starts are the only visible cost
and showed up even with the 5-minute cron, so instances are evicted faster
than the documented production idle window or the cron does not reach the same
instance; measure before deciding whether that needs a shorter schedule.

Database compatibility, raw TCP egress on 5432 with TLS and platform latency
are all proven.

## Repo shape (decided 2026-10-07, revised 2026-10-08)

The cloud is the product surface a visitor experiences: website, docs and
the server. All three ship from this repo:

- `apps/cloud`: the server service. It keeps its own hostnames
  per the design docs (`{region}.zitadel.cloud`, dashboard subdomain)
  because the API has no path prefix and cannot be path-composed under the
  website's origin without shadowing marketing pages.
- `apps/docs` (exists): since 2026-10-08 a second **service** of the cloud
  project, see the next section. The earlier plan of composing it under
  `zitadel.com/docs` via Vercel Microfrontends is unchanged for the
  website; the cloud host serves the same build under `/docs`.
- `apps/website` (scaffolded 2026-10-08): the third service of the cloud
  project, a Next.js app with the stack of `zitadel/new-website`
  (`apps/website` there) and one start page; owns `/` and `/_next/*` on the
  cloud host. Importing the real pages, theme and content from
  `zitadel/new-website` is the next step; content PRs must not trigger the
  Go gates.

`apps/cloud` is **not** moved to the website or infra repos: the launcher
mirrors server config semantics and the deploy is a function of the pinned
server version, so it changes in the same PRs as the server.

## Docs as a second service (2026-10-08)

Vercel Services (Beta) let one project build several roots separately and
route between them at the edge. Three options were weighed for "API plus
docs on the cloud host":

| | Services | Wrapper project with rewrites | Microfrontends |
|---|---|---|---|
| Build per app | yes | yes | yes |
| Deploy and roll back per app | no, one deployment | yes | yes |
| Extra hop | none | one (edge → target project) | none |
| Cost | included | included | 2 projects included, $250/project beyond |

Services were chosen: the server image rebuilds in about 15 s, so a docs
merge rolling the server to a new deployment of the same image costs nothing
noticeable, and one deployment means one route table, one Deployment
Protection setting and one firewall for both. Independent lifecycles were
not needed yet; if they become needed, the same path map moves into
Microfrontends or a wrapper project without touching the apps.

What the spike settled:

- `vercel.json` lives at the repository root, because service roots are
  relative to it and the two roots (`apps/cloud`, `apps/docs`) have no common
  ancestor below the root. All other Vercel projects of this repo set a Root
  Directory, so the file is only read by the cloud project. A `.vercelignore`
  keeps Go sources and artifacts out of CLI uploads (~9 MB, 2.3k files).
- The docs service builds **unchanged** at base `/`: the site already serves
  `/docs/*` and `/reference/*` and answers 404 at `/`, so no base path is
  needed. Waku supports `basePath`, but its Vercel build enhancer keeps the
  RSC function at `/RSC` while rewriting to `<base>/RSC/`, so a prefixed
  mount would need post-build patching. Listing the docs prefixes in the
  top-level rewrites was the smaller contract.
- `installCommand` per service runs in the service root; `corepack pnpm
  install --filter @zitadel/docs...` from `apps/docs` resolves the workspace
  upward. `ENABLE_EXPERIMENTAL_COREPACK=1` on the project pins pnpm to the
  workspace's `packageManager`; without it Vercel would run the oldest pnpm
  for an override install command.
- `regions`, `crons`, `redirects` and `git` stay top-level in services mode.
- Per-service `ignoreCommand` was not tested: the server build is too cheap
  to justify skipping it.

First services deploy (2026-10-08, staged with `--prod --skip-domain`, then
promoted): upload 9.1 MB / 2.3k files, container service built in 3 s (layer
cache cold), docs service in 2 min (install, OpenAPI bundle, four Vite
environments, 341 static files), whole build 2 min 20 s. Every probed path
answered from the right service: `/readyz`, `/sessions/me` (401), unknown
paths (server 404) from the container; `/docs`, `/docs.md`, `/docs/*`,
`/reference/api/*`, `/assets/*`, `/api/search`, `/llms.txt` from the docs,
`/` redirecting to `/docs`. Smoke test green, docs pages answer in ~10 ms.

## Website scaffold (2026-10-08)

`apps/website` joins as the third service: Next.js 16 (App Router), React
19, Tailwind 4 through `@tailwindcss/postcss`, TypeScript on the workspace
base config, one static start page linking to `/docs` and `/ui/console`.
The stack is the one `zitadel/new-website` uses, minus its theme package,
fonts, CSP, redirects, analytics and MDX content, so its pages can move here
file by file. Routing: the website owns `/` and `/_next/*`; the server stays
the catch-all. That is enough for a start page and wrong for a real site,
whose pages would each need a rewrite; when the import happens the server
moves to its own hostname with a route-by-host rewrite and the website takes
the catch-all. Catalog entries cover react, the type packages, tailwindcss
and typescript; `next` and `@tailwindcss/postcss` are pinned in the app like
`apps/demo-next` does.

## Main is production, all on Vercel (2026-10-08)

Decision: the cloud runs the server of the current `main` commit, compiled
by Vercel itself from the repository (a pure Go build, first as a container
image, since the same day on the Go runtime, see below), with the console and the login UI built as their own static services
at `/console` and `/login` from the same commit (their Vite base paths are
build-time configurable; the embedded defaults stay `/ui/console` and
`/ui/login` for self-hosters). Nothing passes
through a registry: Vercel keeps one image per deployment in its container
registry, and rollback is "promote the previous deployment". Version tags,
their images and npm packages stay the self-hoster artifact, built by the
unchanged release pipeline; PR checks stay in `ci.yml`. Reasons: the
preview cloud exists to show the latest state; a pinned tag goes stale by
construction; a GHCR `sha-` image built in GitHub (the first design of the
day) only existed so that `migrate` could run from the identical image, and
a `go build` of the same commit in the workflow gives the same migrations
for a fraction of the machinery. Splitting the UIs out of the image is what
makes the Vercel build cheap: the container build is a pure Go compile, the
UIs get Vercel's native static builds.

Safety rules that make this acceptable, in their final form (the first
version ran the migrations in a GitHub workflow; see "Migrations in the
build" for what replaced it):

- Migrations run only in the build of the commit being deployed, before the
  deployment goes live, never at startup; the serving function refuses
  `--migrate` (launcher guard with a test).
- Production values (database URL, migrator URL, master key, admin document)
  exist in the Production target only; previews get their own in the
  Preview target. "A preview silently migrates the production database" is
  impossible by configuration, not by discipline.
- Rollback promotes a previous deployment and relies on expand/contract
  migrations.

Storybook joined as a service (`/storybook`): `@zitadel/components` is a
published package and its storybook is product documentation, the same
argument as for the docs. The static build is relocatable (Vite base `./`),
only the mock service worker URL had to follow the base so its scope stays
under `/storybook/`. Bare prefixes (`/storybook`, `/console`,
`/login`) redirect to the slash form, because a relocated static app at
its bare prefix resolves relative asset links against `/`.

The docs keep the prefix-list routing of the previous section. A base path
(`DOCS_BASE_PATH=/docs`, Waku `basePath`) was tried the same day so that the
route table is one rewrite per app: Waku's Vercel adapter prefixes its routes
but leaves the static files and the RSC function at the root of the Build
Output, so a post-build script had to relocate them, and the pages had to
move from `content/docs` to the content root to avoid a `/docs/docs` segment.
That moved 40 files and changed the standalone site's URLs for a routing
convenience, so it was reverted: the docs build unchanged, and the cloud
lists their paths (`/docs`, `/reference`, `/assets`, `/RSC`, `/api/search`,
`/llms.txt`, `/llms-full.txt`, `/mcp`) in the rewrites. Should the docs ever
move to Next.js, its native `basePath` makes the one-prefix layout free.

Open follow-up in the server: an "external UI" mode. Today the server
refuses to boot when an enabled UI is not embedded (`ValidateDist`) and
mounts `/console/runtime.json` only while one is enabled, so the server build
writes stub `index.html` files for both UIs. Serving the runtime endpoint
with the embedded UIs disabled removes the stubs and makes the split honest.


## One schema per PR preview (2026-10-08)

The server now runs in any Postgres schema: `?search_path=<schema>` on the
DSN (or `schema:` in the map form) redirects every statement and every
migration, and the goose history lives in that schema too (see the
configuration guide). That is what makes a working server preview per PR
cheap without a database branch per PR: one PS-DEV branch `preview` holds a
schema per pull request.

- Per PR: the build step appends `search_path=pr_<n>` to the Preview
  target's database URL and migrates; the function serves from the same
  schema. The schema is created by `migrate` itself, so no admin role and no
  `CREATE DATABASE` step exist. The Preview target carries its own master
  key and admin document.
- On close: `DROP SCHEMA pr_<n> CASCADE` (`cloud-preview-cleanup.yml`).
- Extensions are per database and are pinned to `public` for every
  non-default schema, so all previews share them.
- Still open: a corpus fixture seeded through the public API the way
  `console:dev-real` seeds a local instance.

## Go runtime instead of the container (2026-10-08)

Decision: the `server` service uses Vercel's Go framework preset
(`"framework": "go"`, `buildCommand: sh apps/cloud/vercel-build.sh`) instead
of `Dockerfile.vercel`. The preset runs a bare binary that listens on
`PORT`, so `apps/cloud/launcher` replaces `entrypoint.sh`: it renders the
master key YAML and the admin document into the data dir, follows `PORT`,
refuses `--migrate`, and calls the server command in process. `cmd/server`
is unchanged.

Measured side by side on the same commit, same six services, each server in
its own schema of the preview cluster:

| | container | Go preset |
|---|---|---|
| whole deployment build | 370 s and 403 s | 156 s |
| server build step | minutes (image pull, compile, push) | 38 s incl. toolchain and module download |
| cold `/readyz` after idle | 2.34 s, 2.37 s | 0.31 s, 0.45 s |
| warm `/readyz` | 0.21 s | 0.22 s |
| artifact | image in the registry | 25 MB function in `fra1` |

The cold start no longer pays for an image pull; what remains is the
server's own boot. Nothing is cached for the Go step yet (Vercel picked
go1.26.8 for `go 1.26` and downloaded all modules) and it is still the
cheapest part of the build. Fluid compute is on for the project, so idle
functions scale to zero and the measured cold start is what a first request
pays; the keep-warm cron of the container days is gone.

## Migrations in the build, Git deployments on (2026-10-08)

Decision: the GitHub runner leaves the deploy path. `vercel-build.sh` runs
`launcher migrate` right after compiling, so migrations run at deploy time
inside the Vercel build and never at startup: production with the migrator
role and only from `main` (`VERCEL_GIT_COMMIT_REF` guard in the launcher),
a preview in `pr_<VERCEL_GIT_PULL_REQUEST_ID>` of the preview database.
The launcher applies the same schema rule at runtime, so build and function
always agree. `git.deploymentEnabled` is on: a push deploys. The workflow
is reduced to dropping `pr_<n>` on pull request close. Each non-default
schema takes its own migration advisory lock, so parallel preview builds on
one database neither serialize nor deadlock on `CREATE INDEX CONCURRENTLY`.
Self-hosters are untouched: `nextgen server --migrate` and `nextgen migrate`
keep their behavior, the default schema keeps its lock.

Given up: the smoke test in the pipeline (the script stays for manual
runs; Vercel checks or a `deployment_status` action can bring it back) and
the `main`-only migrator credential in a GitHub environment, replaced by the
branch guard plus "who can create production builds".

## Regions (deferred, needs a buyer)

Customer-chosen regions require a global layer. The cheapest version is
nextgen's own platform project in a home region plus replication, not a
separate product. The seams, in build order:

1. Project → region directory and `{region}.<domain>` routing (resource
   scope lookup is per database; the request must land in the right region).
2. Console session validation without a cross-region DB read (signed,
   short-lived token, or replicated session table).
3. Platform membership projection replicated to every region so `CheckAuthz`
   stays one query ([ADR 053 §2](../../adrs/053-cross-project-principals.md)
   names this as the later step).
4. Claim as a two-step write with repair.
5. System catalog version parity across regions on rollout.
6. Region chosen at create; project move = export/import, which does not
   exist yet.

Nothing of this is needed for a single-region preview cloud.

## Open

- A corpus fixture for previews, seeded through the public API.
- An external-UI mode in the server (serve `/console/runtime.json` with the
  embedded UIs disabled) so the build stops writing stub `index.html` files.
- A boot-time schema version check in the server, and a database-aware
  readiness endpoint (`/readyz` is constant today).
- The smoke test back in the pipeline, as a Vercel check or a
  `deployment_status` action.
- Where the dev-inbox and egress-policy defaults land for a shared host
  ([ADR 050](../../adrs/050-dev-inbox.md), [ADR 061](../../adrs/061-egress-policy-user-injectable-urls.md)),
  and whether the preview cloud ever flips a project to production mode.
