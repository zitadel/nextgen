# Runbook: preview cloud (Vercel + PlanetScale Postgres)

> **Status:** Live (2026-10-08)
> **Code:** [`apps/cloud/`](../../apps/cloud/)
> **Design:** [preview-cloud-vercel-planetscale.md](../design/platform/preview-cloud-vercel-planetscale.md)

The preview cloud is the server of the current `main` commit, compiled by
Vercel from the repository and run as a container image in Frankfurt
(`fra1`) against one PlanetScale Postgres database in AWS `eu-central-1`. **Main is production** for this cloud: every push to `main`
deploys, every pull request gets a preview, and everything builds on Vercel.
Version tags (`1.0.0-alpha.N`), their images and npm packages are the
self-hoster artifact, produced separately by `release-publish.yml`, and are
not what the cloud runs. Production stays on GCP; this is a single-region
preview offering with the same topology as self-hosted.

The Vercel project is one deployment with seven
[services](https://vercel.com/docs/services), defined in the repo-root
`vercel.json`:

| Service | Root | What it is | Public paths |
|---|---|---|---|
| `server` | `.` | the Go server as a container image (`Dockerfile.vercel`: one static binary, `apps/cloud/launcher`, no embedded UIs) | everything not listed below, incl. `/console/runtime.json` |
| `migrate` | `.` | internal, never routed: a Go-runtime service whose build step runs the migrations (`apps/cloud/vercel-build.sh`) | none |
| `console` | `apps/console` | the console SPA, built with `CONSOLE_BASE_PATH=/console`, relocated to `out/console` | `/console/*` |
| `login` | `apps/login-ui` | the login UI, built with `LOGIN_BASE_PATH=/login`, relocated to `out/login` | `/login/*` |
| `docs` | `apps/docs` | the docs site (Waku), built unchanged at base `/` | `/docs*`, `/reference/*`, `/assets/*`, `/RSC/*`, `/api/search`, `/llms.txt`, `/llms-full.txt`, `/mcp*` |
| `storybook` | `apps/storybook` | the `@zitadel/components` workbench, static build relocated to `out/storybook` | `/storybook/*` |
| `website` | `apps/website` | the website scaffold (Next.js), one start page | `/`, `/_next/*` |

The route table is one rewrite per prefix (the docs have several, because
the site serves its pages at `/docs` and `/reference` and its runtime files
at the root), one exception (`/console/runtime.json` stays with the server)
and the server catch-all. The server's own namespaces (`/projects`,
`/users`, `/sessions`, …) never overlap with those prefixes; a new
top-level docs route needs a rewrite entry. Bare UI prefixes redirect to
the slash form (308), as the server's own UI handler does, because the
static apps reference their assets relative to that directory.

The server is told the UI prefixes too (`NEXTGEN_SERVER_CONSOLE_PATH`,
`NEXTGEN_SERVER_LOGIN_PATH`), so the console base URL it derives for the
platform project matches where the console service lives. Once the website
has real routes, move the server to its own hostname (route by host in the
same file) so the website can own every path.

## One-time setup

### 1. PlanetScale

1. Production: a **Postgres** database (not Neki) in `eu-central-1`, PS-10 HA
   once anyone depends on it, PS-5 for a first try. Two roles on its `main`
   branch:
   - `preview-migrator`: `postgres` grant. Used only by the build step's
     `launcher migrate` (`CLOUD_MIGRATOR_DATABASE_URL`).
   - `preview-server`: `pg_read_all_data` + `pg_write_all_data`. Used by the
     running server.
2. Previews: a second database (`zitadel-preview`, PS-DEV is enough) with one
   role `preview-pr` that inherits `postgres`: it creates the schema of each
   pull request and installs the extensions into `public`. Every preview is
   a schema of this database, never a branch.
3. Two ports per database: the running server connects through the local
   PgBouncer on `6432` (transaction pooling, 20 server connections per role
   shared by every instance), the migrations through the direct port
   `5432`, because goose holds a session advisory lock. Both with
   `sslmode=verify-full&sslrootcert=system`. Vercel starts one container
   per simultaneous request when none is warm, each with its own pgx
   pool, so without the pooler a burst exhausts a small cluster's
   `max_connections` (PS-DEV: 25) within seconds.

### 2. Master keys

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out master-key.pem
base64 < master-key.pem | tr -d '\n' > master-key.b64
```

One key for production, a different one for previews. Keep the production
`master-key.pem` in the team password manager. Losing it makes every
project's key-encryption key unwrappable ([ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md)).

### 3. Vercel project

1. Create a project in the team with **no Root Directory**: the repository
   root is the deployment root, `vercel.json` there defines the services and
   their roots. Connect the GitHub repository (section 4).
2. Environment variables, by target. Add them with the Vercel CLI
   (`npm i -g vercel`, or `npx vercel`) from the repo root:
   `vercel env add NAME production --sensitive --yes` with the value on
   stdin for secrets, `--no-sensitive` for plain config.

   | Name | Target | Value |
   |---|---|---|
   | `NEXTGEN_DATABASE_POSTGRES` | Production, secret | `postgresql://preview-server…:6432/postgres?sslmode=verify-full&sslrootcert=system&default_query_exec_mode=cache_describe&pool_max_conns=4` (the pooled port; `cache_describe` keeps pgx off named prepared statements) |
   | `CLOUD_MIGRATOR_DATABASE_URL` | Production, secret | the `preview-migrator` role on the direct port `5432`; only `launcher migrate` reads it |
   | `MASTER_KEY_PEM_B64` | Production, secret | contents of the production `master-key.b64` |
   | `BOOTSTRAP_ADMIN_USER_JSON_B64` | Production, secret | the platform admin's bootstrap document (section 5) |
   | `NEXTGEN_SERVER_PUBLIC_BASE` | Production | the public origin, e.g. `https://preview.zitadel.cloud` |
   | `DOCS_SITE_URL` | Production | the public origin (canonical and sitemap URLs of the docs) |
   | `NEXTGEN_DATABASE_POSTGRES` | Preview, secret | the `preview-pr` role of `zitadel-preview` on the pooled port, same parameters as production; each preview appends `schema=pr_<n>` itself |
   | `CLOUD_MIGRATOR_DATABASE_URL` | Preview, secret | the same role on the direct port `5432`, for the build step's migrate run |
   | `MASTER_KEY_PEM_B64` | Preview, secret | contents of the preview `master-key.b64` |
   | `BOOTSTRAP_ADMIN_USER_JSON_B64` | Preview, secret | a preview admin document (section 5) |
   | `MASTER_KEY_ID` | both | `preview-2026-10` (stable; rotation adds a new id) |
   | `NEXTGEN_INSTRUMENTATION_LOG_FORMAT` | both | `json` |
   | `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` | both | `true` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | both | `1` (build time; the UI services install with `corepack pnpm`, which pins the workspace's pnpm) |
   | `CONSOLE_BASE_PATH`, `LOGIN_BASE_PATH` | both | `/console`, `/login` (build time; the prefix each UI build is served under) |
   | `NEXTGEN_SERVER_CONSOLE_PATH`, `NEXTGEN_SERVER_LOGIN_PATH` | both | `/console`, `/login` (the server derives the console base URL from it) |

   Production values exist in the Production target only, preview values in
   the Preview target only, so a preview cannot reach the production
   database or key by configuration. The launcher follows Vercel's `PORT`
   on its own.

   `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true` is what makes this a cloud: the
   server provisions the reserved platform project, the Console signs into
   it, and claiming and self-registration work. Without it the Console runs
   in standalone mode and manages whichever customer project was created
   first, which on a shared host is whatever the smoke test created.
3. Function settings: memory 2 GB (default), max duration 60 s is plenty.
   `PORT=8080` must stay set: the container runs as uid 65532, which cannot
   bind Vercel's default port 80.
4. Domain: assign the custom domain and set `NEXTGEN_SERVER_PUBLIC_BASE` to
   match it exactly. CSRF and WebAuthn derive the origin from Vercel's
   `X-Forwarded-Host` / `X-Forwarded-Proto`, which already carry the custom
   domain.

### 4. GitHub

Connect the repository to the Vercel project (Project → Settings → Git, or
`vercel git connect` from the repo root). `vercel.json` has Git deployments
enabled: every push to `main` is a production deployment, every push to a
pull request branch a preview deployment, and the Vercel bot posts the
preview URL on the pull request. No GitHub Actions secrets are needed for
deploying or migrating.

One repository secret for the cleanup workflow
(`.github/workflows/cloud-preview-cleanup.yml`):

| Kind | Name |
|---|---|
| secret | `PREVIEW_CLOUD_PREVIEW_DATABASE_URL` (the `preview-pr` role) |

It drops `pr_<number>` when a pull request closes. Without it the job logs
that there is nothing to drop and the schema stays until someone drops it.

### 5. Platform admin

The platform project has no users until someone registers or a bootstrap
document seeds one. The document is the one `zitadel start` writes for its
local admin ([`admin-credential.ts`](../../apps/cli/src/lib/local-server/admin-credential.ts)):
a header naming `proj_platform`, the user and team ids, the attributes, and
a PBKDF2 hash of the password, never the password. Mint one with the CLI in
a scratch directory and rename it:

```sh
mkdir cloud-admin && cd cloud-admin
npx @zitadel/cli@alpha start && npx @zitadel/cli@alpha stop
# .zitadel/local/admin.json holds the generated password: move it to the
# password manager. In .zitadel/local/admin-user.json set header.id,
# header.team_id, attributes.username and attributes.email to the cloud
# admin's values (for example user_platformadmin, team_platformadmin,
# ops@example.com).
base64 < .zitadel/local/admin-user.json | tr -d '\n' \
  | vercel env add BOOTSTRAP_ADMIN_USER_JSON_B64 production --sensitive --yes
```

The launcher renders the document to the data dir and passes `--user-file`;
the server imports the user into `proj_platform` on the next deploy and
skips it afterwards, so the variable can stay set. To rotate the password,
mint a new document with the same ids, delete the old user, redeploy. The
Preview target gets its own document the same way.

## Deploying

- **Production:** every push to `main`. Vercel builds all seven services;
  the `migrate` service's build step (`apps/cloud/vercel-build.sh`) compiles
  the launcher and then runs `launcher migrate`, which applies the
  migrations against the production database with the migrator role
  (`CLOUD_MIGRATOR_DATABASE_URL`) **before** the deployment goes live, while
  the `server` container builds beside it (a Docker build has neither the
  environment nor the network to migrate, hence the separate service). A
  failed migration fails the whole deployment and the previous one keeps
  serving. The launcher refuses to migrate production unless
  `VERCEL_GIT_COMMIT_REF` is `main`, so a `vercel deploy --prod` from a
  feature branch fails its build instead of changing the production schema.
- **Previews:** every push to a pull request branch. The same build step
  migrates the preview database in the schema `pr_<number>` (branch name
  without a pull request: `br_<name>`), the container serves from that
  schema, and nothing is shared between previews except the database's
  extensions in `public`. The schema travels as the `schema` parameter of
  the connection string, which the server consumes itself: PgBouncer
  rejects `search_path` as a startup parameter. See the configuration
  guide on Postgres schemas.
- **Startup never migrates:** the function starts the server without
  `--migrate` and refuses one.

`migrate` is idempotent: on a docs-only push it connects, finds nothing
pending and exits. Only commits that add migrations apply something, and
every migration must be expand/contract: the previous deployment keeps
serving until the new one is live, and a rollback promotes an older
deployment on the newer schema. The build script stamps the version, the
deployment's commit (`VERCEL_GIT_COMMIT_SHA`) and the date into the binary.

All services are rebuilt on every deploy. The container build (toolchain
image pull, module download, compile, image push, no layer cache) is the
long pole at six to seven minutes; the migrate service's Go build takes
under a minute plus the migration run.

### Manual and staged deploys

A `vercel deploy` from the repo root builds exactly the checked-out tree
(`.vercelignore` trims the upload) and migrates like any other build: a
preview deploy migrates the schema of the local branch (`br_<name>`, or
`pr_<n>` when the branch has a pull request), a `--prod` deploy migrates
production only when the local branch is `main`. To point a manual preview
at an existing schema, pass the URLs with `schema=<name>` to both the build
and the function: `--build-env CLOUD_MIGRATOR_DATABASE_URL=<direct port>…`
and `-e NEXTGEN_DATABASE_POSTGRES=<pooled port>…`.
A CLI upload carries no Git metadata, so the binary of a manual deploy
reports the commit as `unknown` unless `--build-env VERCEL_GIT_COMMIT_SHA=…`
is passed as well.

A **staged production deploy** is `vercel deploy --prod --skip-domain` from
`main`: it builds and migrates with production settings without moving the
production domain. Smoke it with the project's protection-bypass header
(`VERCEL_AUTOMATION_BYPASS_SECRET=… corepack pnpm exec tsx apps/cloud/scripts/smoke.mts <url>`),
then `vercel promote <url>`.

The serving function refuses `--migrate` (see `apps/cloud/launcher`), so
no deploy of any kind can change the schema by starting; only the build
step's explicit migrate run can.

### Rollback

Promote the previous deployment in the Vercel dashboard (Deployments → … →
Promote to Production) or `vercel promote <url>`; Vercel keeps every
deployment's functions. All services roll back together: they are one
deployment. A schema that the older binary cannot read is **not** rolled
back; that is what the expand/contract rule protects. A fresh build of an
older state is a revert on `main`.

## Lessons (2026-10-07/08)

- Service objects need an explicit `framework`. With `"framework": null`
  the build finishes in one second, builds nothing, and every path is a 404
  from the edge; with several frameworks detectable at the repo root (Vite,
  Storybook) every service must name its own.
- The Vercel MCP connector could create the project but was refused (403)
  on environment variables; use `vercel env add NAME production,preview
  --sensitive --yes` with the value on stdin. A `--value` flag with an open
  stdin hangs the CLI after a successful add.
- This team stores new variables as **Secret** by default, so plain config
  added without a flag ends up unreadable in the dashboard. Pass
  `--no-sensitive` for config and `--sensitive` only for real secrets
  (database URLs, master keys, bootstrap documents).
- The team default Vercel Authentication (`all_except_custom_domains`) did
  not block the production alias `nextgen-preview-cloud.vercel.app`; it does
  protect preview and deployment URLs. Verify after any protection change.
- `.vercelignore` uses gitignore syntax: an unanchored `docs` also drops
  `apps/docs`, and the build then fails with "Service docs has root apps/docs
  but that directory does not exist". Anchor repo-root entries with `/`.
- Rewrite sources use `(.*)`, not `:path*`: `/docs/:path*` matched `/docs`
  and `/docs/a` but not `/docs/` (trailing slash, empty segment), which fell
  through to the server's 404. Each prefix is listed twice, bare and with
  `/(.*)`.
- Serving a relocated static app at its bare prefix (`/storybook`) breaks
  it: the page loads but its relative asset links resolve against `/`.
  Bare prefixes redirect to the slash form instead.
- The server validates at boot that every enabled embedded UI has an
  `index.html` (`ValidateDist`) and mounts `/console/runtime.json` only while
  a UI is enabled. With the UIs served as Vercel services, the build script
  writes a stub `index.html` per UI so the server boots and keeps the
  runtime endpoint; the stubs are shadowed by the route table. The clean
  fix is a server change: serve the runtime endpoint with both embedded UIs
  disabled (`console_enabled`/`login_enabled` false), then drop the stubs.
- Storybook builds with moon, so a CLI upload must contain every moon
  project source (`tools/` stays out of `.vercelignore`); moon itself runs
  fine without a `.git` directory.
- The build log warns that the repo-root `api/` directory "will not be built
  because services are configured". That is Vercel's serverless-functions
  convention noticing a directory that is OpenAPI sources and Go code; the
  docs service reads `api/openapi` as files, nothing is lost.
- Without `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` the Console picked the oldest
  customer project as its standalone target, which was a local test project
  whose keys were wrapped with a discarded master key, so
  `/console/runtime.json` answered 500 (`enc_key.not_found`). The flag pins
  the Console to `proj_platform`. That stale `pg-smoke` row
  (`proj_01M4C6YJGKREDXW8XAC1PJVDZQ`) is still in the production database
  and harmless; drop it when convenient.
- A Waku `basePath` for the docs (one `/docs/(.*)` rewrite instead of the
  prefix list) needs a post-build relocation of Waku's Vercel output and
  moves the pages out of `content/docs` to avoid a `/docs/docs` segment. Not
  worth it; the prefix list stays.
- Vercel's Go runtime (Beta) is not on Fluid compute: one request per
  instance, and under 24 concurrent requests it failed 10 outright. The
  container image serves concurrent requests per instance (Vercel reports
  the peak concurrency in the function detail). Both fan out to one
  instance per simultaneous request from cold.
- PlanetScale's PgBouncer rejects `search_path` as a startup parameter
  (`unsupported startup parameter`, 08P01); that is why the schema is a
  `schema` parameter the server consumes. `pool_max_conns` and
  `default_query_exec_mode` are consumed by pgx the same way.

## Operating

- **Logs:** Vercel runtime logs of the `server` function. Add a log drain
  for retention.
- **Cold starts:** container instances scale to zero after 5 minutes idle
  in production and 30 seconds in previews; a cold start is about 2.4 s
  (image start plus server boot), warm requests 0.2 s. The cron in
  `vercel.json` hits `/readyz` every 5 minutes on production to keep one
  instance warm; previews pay the cold start per visit.
- **Bursts and database connections:** Vercel starts one container per
  simultaneous request when none is warm and adds instances under load;
  each instance is a full server with its own pgx pool. Through PgBouncer
  the server-side connection count stays flat (measured: three bursts of
  24 seeded project creations, 72 of 72 answered 201); on the direct port
  the same bursts exhausted a PS-DEV cluster's 25 connections within
  seconds and the instances that could not reach the database failed
  their boot, which Vercel reports as `FUNCTION_INVOCATION_FAILED`. The
  migrate step still uses the direct port, so a production build during a
  heavy burst on a small cluster can fail on a refused connection; retry
  the deployment. See the design note for the measurements.
- **Egress:** no static IP for functions. The database is protected by TLS
  and the role password only.
- **Smoke test by hand:**

  ```sh
  corepack pnpm exec tsx apps/cloud/scripts/smoke.mts https://preview.zitadel.cloud
  ```

  It creates one throwaway project and exercises readiness, project and
  user creation, a query, the session middleware, and one page of every
  UI service.

- **Preview schemas:** `pr_<n>` is dropped by the cleanup workflow when the
  pull request closes. Schemas of manual deploys (`br_<name>`) and of
  closed pull requests from before the workflow had its secret are dropped
  by hand: `DROP SCHEMA <name> CASCADE` on `zitadel-preview`.

- **Master key rotation:** add a second key under a new `MASTER_KEY_ID`
  following ADR 029; this wrapper supports exactly one key per deployment
  today, so rotation needs a small extension of the launcher first.

## Known limits

- Vercel container images (Beta) and functions: request and response bodies
  are capped at 4.5 MB, max duration per plan (300 s default), SIGTERM with
  a 30 s grace period on scale-in.
- Scale-to-zero means in-process state (the request wide-event buffer of
  [ADR 048](../adrs/048-wide-events-internal-audit-primitive.md)) can be lost
  on scale-down; the server flushes on `SIGTERM`.
- No background job loop exists in this tree yet ([ADR 065](../adrs/065-background-jobs.md)
  is proposed). When it lands, scale-to-zero stalls periodic jobs while idle.
- Regions: one. Customer-chosen regions need the global layer described in
  the design note's "Regions" section.
