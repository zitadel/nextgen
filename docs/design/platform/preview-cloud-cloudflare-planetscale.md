# Preview Cloud on Cloudflare Containers + PlanetScale Postgres

> **Status:** Draft plan (2026-10-07). **Superseded in part on 2026-10-07:** the
> deployment target is now Vercel container images (`apps/cloud/`,
> runbook `docs/runbooks/preview-cloud.md`). The Cloudflare Containers design
> below stays as the recorded alternative; the database findings still apply.
> **See also:** [Overview](overview.md) · [Claim Flow](claim-flow.md) ·
> [ADR 053](../../adrs/053-cross-project-principals.md) ·
> [ADR 065](../../adrs/065-background-jobs.md) ·
> [Operations example config](../../operations/nextgen.example.yaml)
>
> **Scope:** a hosted *preview* cloud for nextgen. Production stays on GCP
> (Spanner). Multi-region placement is explicitly deferred to Phase 4 and
> gated on a buyer for residency.

## Assumptions

- Compute: Cloudflare Containers (GA since 2026-04), `default` scheduling
  policy, one Worker in front, one Durable Object per container replica.
- Database: PlanetScale **Postgres** (GA), not Neki. Neki is in platform
  preview with no SLA, one region per database, and a ~$36/mo floor per
  shard. It stays a later in-region option; nextgen's `(project_id, id)`
  keying already fits it.
- One region to start. The platform project, customer projects, and the
  database live together, exactly like self-hosted. The region split is a
  separate build (Phase 4) and is not needed for a preview offering.
- nextgen runs unchanged: single Go binary, `linux/amd64`, port 8080,
  Postgres dialect, in-process job loop ([ADR 065](../../adrs/065-background-jobs.md)).

## Target shape

```text
browser / CLI
   │  https://preview.<domain>   (Cloudflare DNS + TLS)
   ▼
Worker (router)
   │  hostname → DO id `replica-N` (N in 0..REPLICAS-1), round-robin
   ▼
Durable Object ─── ctx.container ─── nextgen (basic: 1/4 vCPU, 1 GiB, 4 GB disk)
                                        │ TCP 5432 + TLS verify-full
                                        ▼
                               PlanetScale Postgres (single region)
```

- Replicas are stateless. Master keys are injected; `generate_master_key`
  is `false` so an ephemeral disk never mints a key.
- Every replica runs the job loop; the SQL lease is the lock. One replica is
  kept awake by a Worker cron so periodic jobs run while idle.
- Migrations run as a one-shot step before the rollout, never as the serving
  container's `CMD`.

## Phases

### Phase 0 — Decisions (half a day)

| Decision | Recommendation | Why |
|---|---|---|
| Region | Cloudflare `WEUR` placement + PlanetScale `eu-west-1` (AWS) or `europe-west4` (GCP) | Pick by measured container→DB p50 in Phase 1; GCP keeps a PSC path open later |
| DB size | PS-5 single node ($5/mo) for the spike, PS-10 HA ($30/mo) once people depend on it | Single node has maintenance downtime |
| Instance type | `basic` (1 GiB) | argon2id at 64 MiB × 4 threads plus the embedded UIs will not fit `lite` |
| Replicas | 2 | Survives one host restart; no autoscaling exists |
| Domain | one hostname, e.g. `preview.zitadel.cloud` | `public_base` must match it |
| Claim allowed? | yes, free | matches [overview](overview.md); production *mode* stays off |

### Phase 1 — Prove the two unknowns (1–2 days)

Nothing else matters if either fails.

1. **Postgres compatibility.** Create the PlanetScale database and run the
   storage suite against it from a laptop:

   ```sh
   ZITADEL_TEST_POSTGRES_URL='postgres://…:5432/nextgen?sslmode=verify-full' \
     go test ./internal/storage/... -count=1
   ```

   Exit: green. PlanetScale Postgres is plain Postgres behind PgBouncer, so a
   failure here is a pooler/transaction-mode issue, not a dialect issue.

2. **Raw TCP egress from a container.** Deploy the release image as-is with
   `NEXTGEN_DATABASE_POSTGRES` pointing at PlanetScale. Exit: `--migrate`
   completes and `/readyz` answers 200. Record container→DB p50/p99 and
   cold-start time for the ~60 MB image. Cloudflare documents HTTP egress
   controls only; raw 5432 is implied, not stated.

   Fallback if TCP is blocked: Hyperdrive is Workers-only, so the fallback is
   a different host (Fly.io, Cloud Run), not a different driver.

### Phase 2 — Image, config, secrets (2–3 days)

- **Config delivery.** Nested master keys cannot be bound from env (viper
  `AutomaticEnv` only resolves keys it already knows). Add a thin image layer
  whose entrypoint writes `/etc/nextgen/nextgen.yaml` from one env var
  (`NEXTGEN_CONFIG_YAML`) and then `exec`s `nextgen`. The server already
  searches `/etc/nextgen`.
- **Secrets.** Master key PEM, database URL, and any SMTP/IdP secrets live as
  Worker secrets and are passed to the container via `envVars` at start.
  `server.generate_master_key: false`.
- **Image source.** Releases publish to GHCR; Cloudflare's registry pulls
  from Docker Hub, ECR, and Google Artifact Registry only. CI pulls the GHCR
  tag and runs `wrangler containers push`. Alternative: mirror to GAR, which
  prod already has.
- **Health.** Wire `pingEndpoint` to `/readyz` (the spec also exposes `/healthz` and `/livez`) so a replica only
  receives traffic once migrations and key loading are done.
- **Migrations.** A second container class `migrator` runs the `nextgen migrate` subcommand
  (same image, different argv) triggered by the deploy pipeline before
  `wrangler deploy`. Rollouts go 10 % → 100 % with old and new binaries
  serving at once, so every migration must be expand/contract safe. The goose
  advisory lock already serialises concurrent migrators.

### Phase 3 — Router, keep-alive, pipeline (3–4 days)

- **Worker router.** Map the hostname to DO ids `replica-0..N-1`,
  round-robin per request, retry once on a connect failure. Forward headers
  unchanged; nextgen derives origin and CSRF from `public_base`.
- **Keep-alive.** `sleepAfter` of several hours plus a Worker cron every
  5 min that pings `replica-0`, so the job loop and `jobs.gc` keep running.
- **Rollout.** CI on tag: build nothing, pull image, push, run migrator,
  `wrangler deploy` with `--containers-rollout` default steps. Document the
  manual `none`/rollback path.
- **Observability.** Workers Logs with Logpush to the existing sink; nextgen
  wide events stay in the database per ADR 048. No metrics scraping on
  containers, so export the ADR 065 job metrics through logs for now.
- **Exit criteria.** Fresh `npx @zitadel/setup` against the hostname
  completes registration and passkey login; a claim completes; a release
  rolls out with zero failed requests in a k6 sweep (`moon run bench:sweep`
  pointed at the hostname).

### Phase 4 — Regions (deferred, needs a buyer)

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

Do not start any of this for the preview cloud.

## Risks and how each is retired

| Risk | Impact | Retire by |
|---|---|---|
| Raw TCP egress to Postgres not supported | plan dead on Cloudflare | Phase 1 step 2 |
| Cold-start tail (p95 ≈ 24 s on `default` policy) | first request after a host restart is slow | 2 warm replicas + cron ping; measure in Phase 1 |
| No autoscaling | manual replica count | acceptable for preview; alert on 5xx |
| No static egress IP | cannot IP-allowlist the DB | TLS `verify-full` + password; PSC later if on GCP |
| `Container` class maintained only through 2026-12-31 | API churn | use native `ctx.container` where the docs allow |
| Rolling rollout with mixed binaries | migration breaks old replica | expand/contract rule in Phase 2 |
| Secrets in env of a microVM | exposure via `wrangler containers ssh` | restrict who can ssh; rotate keys per ADR 029 |
| PgBouncer transaction mode | session-state SQL fails | Phase 1 step 1 surfaces it; nextgen keeps no session state except the migration advisory lock, which runs on a direct port |

## Cost (preview, EU, two replicas)

| Item | Monthly |
|---|---|
| Workers Paid base | $5 |
| 2 × `basic` always-on (memory + disk, CPU on use) | ~$14 |
| PlanetScale Postgres PS-5 (PS-10 HA: $30) | $5 |
| Egress (NA/EU $0.025/GB after 1 TB) | ~$0 |
| **Total** | **~$25 (~$50 with HA DB)** |

Numbers are from the Cloudflare and PlanetScale pricing pages as of
2026-10-07 and are estimates, not quotes.

## Open questions

- Does PlanetScale's PgBouncer port (6432) or the direct port (5432) become
  the default URL? Direct keeps savepoints and `FOR UPDATE` semantics simple;
  pooled is what PlanetScale recommends for many short connections. Two
  replicas with pgx pools fit direct connections easily.
- Where do the dev-inbox and egress-policy defaults land for a shared host
  ([ADR 050](../../adrs/050-dev-inbox.md), [ADR 061](../../adrs/061-egress-policy-user-injectable-urls.md))?
- Whether the preview cloud ever flips a project to production mode, or
  claim remains the ceiling.

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
- Nothing in Phase 1 step 1 is left open. The database side of the plan is
  settled.

Latency, measured from a laptop on the US west coast, not from Cloudflare:

| Measure | Value |
|---|---|
| TCP + TLS connect | ~4 s (first connection, includes DNS and handshake) |
| `SELECT 1` round trip | 151 ms |
| `nextgen migrate` (27 files) | 35 s |
| `POST /users/query` | 1.2 s |
| `POST /users` | 3.7 s |

A user create is roughly 20 database round trips, so request latency is
almost entirely RTT × round trips. That is the argument for pinning the
container next to the database: at a 5–15 ms container-to-database RTT the
same calls land in the 100–300 ms range. Measure this from a `WEUR` container
in Phase 1 step 2 before choosing the region pair.

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

Phase 1 step 1 (database compatibility) is done; step 2 (egress and latency
from the platform) moves to the first Vercel deploy.

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

Phase 1 is complete: database compatibility, raw TCP egress on 5432 with TLS,
and platform latency are all proven.

## Repo shape (decided 2026-10-07, revised 2026-10-08)

The cloud is the product surface a visitor experiences: website, docs and
the server. All three ship from this repo:

- `apps/cloud` (this PR): the server container. It keeps its own hostnames
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

`apps/cloud` is **not** moved to the website or infra repos: the entrypoint
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
by Vercel itself from the repository (`Dockerfile.vercel`, Go
only), with the console and the login UI built as their own static services
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

Safety rules that make this acceptable:

- Migrations run only in the workflow, from a binary of the commit being
  deployed, before the deploy, with a credential that lives only in the
  `cloud-preview` GitHub environment (restricted to `main`).
- Serving containers refuse `--migrate` (entrypoint guard with a test).
- The database URL and the master key exist for the Production target only.
  A preview deployment has no database: its server fails to start, which is
  the intended failure mode until previews get their own PlanetScale branch
  and key. "A preview silently migrates the production database" is
  therefore impossible by configuration, not by discipline.
- Vercel's `--build-env` does not reach Docker `ARG`s (verified with a
  non-existent tag: the build still pulled the Dockerfile default), so the
  only input to the container build is the tree itself; the workflow writes
  the commit into `apps/cloud/commit.txt` for the version stamp.
- Rollback promotes a previous deployment and relies on expand/contract
  migrations.

Storybook joined as a service (`/storybook`): `@zitadel/components` is a
published package and its storybook is product documentation, the same
argument as for the docs. The static build is relocatable (Vite base `./`),
only the mock service worker URL had to follow the base so its scope stays
under `/storybook/`. Bare prefixes (`/storybook`, `/console`,
`/login`) redirect to the slash form, because a relocated static app at
its bare prefix resolves relative asset links against `/`.

The docs got a base path too (`DOCS_BASE_PATH=/docs`, Waku `basePath`), so
the whole route table is one rewrite per app. Waku's Vercel adapter prefixes
its routes for a base path but leaves the static files and the server
function at the root of the Build Output, so `apps/docs/scripts/vercel-base-path.mjs`
moves both under the prefix after the build. The docs pages moved from
`content/docs` to the content root at the same time, so the overview is
`/docs/` and every page keeps a single `docs` segment; the standalone docs
site serves the same pages at `/`.

Open follow-up in the server: an "external UI" mode. Today the server
refuses to boot when an enabled UI is not embedded (`ValidateDist`) and
mounts `/console/runtime.json` only while one is enabled, so the cloud image
ships stub `index.html` files for both UIs. Serving the runtime endpoint
with the embedded UIs disabled removes the stubs and makes the split honest.


## One schema per PR preview (2026-10-08)

The server now runs in any Postgres schema: `?search_path=<schema>` on the
DSN (or `schema:` in the map form) redirects every statement and every
migration, and the goose history lives in that schema too (see the
configuration guide). That is what makes a working server preview per PR
cheap without a database branch per PR: one PS-DEV branch `preview` holds a
schema per pull request.

- Per PR: `nextgen migrate` and `vercel deploy` both get
  `NEXTGEN_DATABASE_POSTGRES=…?search_path=pr_<n>` plus a preview master key
  under the Preview target; the schema is created by `migrate` itself, so no
  admin role and no `CREATE DATABASE` step exist. The corpus is seeded
  through the public API the way `console:dev-real` seeds a local instance.
- On close: `DROP SCHEMA pr_<n> CASCADE`.
- Extensions are per database and are pinned to `public` for every
  non-default schema, so all previews share them.
- Still open: the PR workflow itself, the corpus fixture, and the preview
  key in the Vercel Preview target.

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
cheapest part of the build. Open: confirm in the dashboard that the function
runs on Fluid compute; the Services guide says backends do by default.
