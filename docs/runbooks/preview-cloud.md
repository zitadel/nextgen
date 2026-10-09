# Runbook: preview cloud (Vercel + PlanetScale Postgres)

> **Status:** Draft (2026-10-07)
> **Code:** [`apps/cloud/`](../../apps/cloud/)
> **Design:** [preview-cloud-cloudflare-planetscale.md](../design/platform/preview-cloud-cloudflare-planetscale.md)

The preview cloud is the server of the current `main` commit, compiled by
Vercel from the repository and run as a container in Frankfurt (`fra1`)
against one PlanetScale Postgres database in AWS `eu-central-1`. **Main is
production** for this cloud: every merge deploys, and everything builds on
Vercel. Version tags (`1.0.0-alpha.N`), their images and npm packages are the
self-hoster artifact, produced separately by `release-publish.yml`, and are
not what the cloud runs. Production stays on GCP; this is a single-region
preview offering with the same topology as self-hosted.

The Vercel project is one deployment with six
[services](https://vercel.com/docs/services), defined in the repo-root
`vercel.json`:

| Service | Root | What it is | Public paths |
|---|---|---|---|
| `server` | `.` | the Go server, compiled by `apps/cloud/vercel-build.sh` on Vercel's Go runtime and started by `apps/cloud/launcher` (no embedded UIs) | everything not listed below, incl. `/console/runtime.json` |
| `console` | `apps/console` | the console SPA, built with `CONSOLE_BASE_PATH=/console`, relocated to `out/console` | `/console/*` |
| `login` | `apps/login-ui` | the login UI, built with `LOGIN_BASE_PATH=/login`, relocated to `out/login` | `/login/*` |
| `docs` | `apps/docs` | the docs site (Waku), built with `DOCS_BASE_PATH=/docs`, output relocated by `scripts/vercel-base-path.mjs` | `/docs/*` |
| `storybook` | `apps/storybook` | the `@zitadel/components` workbench, static build relocated to `out/storybook` | `/storybook/*` |
| `website` | `apps/website` | the website scaffold (Next.js), one start page | `/`, `/_next/*` |

Every app owns exactly one prefix, so the route table is one rewrite per
service, one exception (`/console/runtime.json` stays with the server) and
the server catch-all. The server's own namespaces (`/projects`, `/users`,
`/sessions`, …) never overlap with those prefixes. Bare prefixes redirect
to the slash form (308), as the server's own UI handler does, because the
static apps reference their assets relative to that directory. The docs
pages live at the content root (`apps/docs/content`), so `/docs/` is the
overview and `/docs/concepts/…`, `/docs/reference/api/…` follow; the
standalone docs deployment serves the same pages at `/`.

The server is told the UI prefixes too (`NEXTGEN_SERVER_CONSOLE_PATH`,
`NEXTGEN_SERVER_LOGIN_PATH`), so the console base URL it derives for the
platform project matches where the console service lives. Once the website
has real routes, move the server to its own hostname (route by host in the
same file) so the website can own every path.

## One-time setup

### 1. PlanetScale

1. Create a **Postgres** database (not Neki) in `eu-central-1`, PS-10 HA once
   anyone depends on it, PS-5 for a first try.
2. Create two roles, each bound to the `main` branch:
   - `preview-migrator`: `postgres` grant. Used only by the deploy workflow.
   - `preview-server`: `pg_read_all_data` + `pg_write_all_data`. Used by the
     running server.
3. Use the direct port `5432` with `sslmode=verify-full&sslrootcert=system`.
   The pooled port is not needed: the server keeps a small pgx pool.

### 2. Master key

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out master-key.pem
base64 < master-key.pem | tr -d '\n' > master-key.b64
```

Keep `master-key.pem` in the team password manager. Losing it makes every
project's key-encryption key unwrappable ([ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md)).

### 3. Vercel project

1. Create a project in the team with **no Root Directory**: the repository
   root is the deployment root, `vercel.json` there defines the services and
   their roots. Both the workflow and the CLI deploy from the repo root
   (`vercel deploy --cwd ../..` from `apps/cloud`). Connecting the GitHub
   repo is fine; the `git.deploymentEnabled: false` in `vercel.json` keeps
   Git pushes from deploying so the workflow stays the only deployer.
2. Environment variables (Production; the build-time ones also for Preview):

   | Name | Value | Sensitive |
   |---|---|---|
   | `NEXTGEN_DATABASE_POSTGRES` | `postgresql://preview-server…:5432/postgres?sslmode=verify-full&sslrootcert=system` | yes, **Production only** |
   | `CLOUD_MIGRATOR_DATABASE_URL` | the `preview-migrator` role, used only by the build step's `launcher migrate` | yes, **Production only** |
   | `NEXTGEN_DATABASE_POSTGRES` (Preview target) | the `preview-pr` role of the `zitadel-preview` database; each preview appends `search_path=pr_<n>` itself | yes, **Preview only** |
   | `MASTER_KEY_PEM_B64` | contents of `master-key.b64` | yes, **Production only** |
   | `MASTER_KEY_ID` | `preview-2026-10` (stable; rotation adds a new id) | no |
   | `PORT` | `8080` | no |
   | `NEXTGEN_SERVER_PUBLIC_BASE` | the public origin, e.g. `https://preview.zitadel.cloud` | no |
   | `NEXTGEN_INSTRUMENTATION_LOG_FORMAT` | `json` | no |
   | `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` | `true` | no |
   | `BOOTSTRAP_ADMIN_USER_JSON_B64` | output of `pnpm run admin-user` (see below) | yes |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (build time; the UI services install with `corepack pnpm`, which pins the workspace's pnpm) | no |
   | `DOCS_SITE_URL` | the public origin, same as `NEXTGEN_SERVER_PUBLIC_BASE` (build time; canonical and sitemap URLs of the docs) | no |
   | `DOCS_BASE_PATH`, `CONSOLE_BASE_PATH`, `LOGIN_BASE_PATH` | `/docs`, `/console`, `/login` (build time; the prefix each UI build is served under) | no |
   | `NEXTGEN_SERVER_CONSOLE_PATH`, `NEXTGEN_SERVER_LOGIN_PATH` | `/console`, `/login` (the server derives the console base URL from it) | no |

   `PORT` is required: Vercel's container router defaults to 80 and the image
   runs as uid 65532, which cannot bind it.

   The database URL, the master key and the bootstrap document exist for the
   Production target only. A preview deployment therefore has no database
   and no key: its server service fails to start, by design, while docs,
   storybook and website previews work. Previews with a working server need
   their own database, or their own schema in a shared preview branch
   (`?search_path=pr_<n>` on the DSN, see the configuration guide), and a
   preview master key under the Preview target; they must never share the
   production database.

   `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true` is what makes this a cloud: the
   server provisions the reserved platform project, the Console signs into
   it, and claiming and self-registration work. Without it the Console runs
   in standalone mode and manages whichever customer project was created
   first, which on a shared host is whatever the smoke test created.
3. Function settings: memory 2 GB (default), max duration 60 s is plenty.
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
document seeds one. Mint the seeded admin once:

```sh
cd apps/cloud
corepack pnpm run admin-user -- --email ops@example.com --out ../../.zitadel/preview-admin \
  | corepack pnpm exec vercel env add BOOTSTRAP_ADMIN_USER_JSON_B64 production --sensitive --yes
```

`admin.json` in the output directory holds the generated password; move it to
the password manager and delete the directory. The entrypoint renders the
document to `/tmp` and passes `--user-file`; the server imports the user into
`proj_platform` on the next deploy and skips it afterwards, so the variable
can stay set. To rotate the password, mint a new document with the same
`--user-id`, delete the old user, redeploy.

## Deploying

- **Production:** every push to `main`. Vercel builds all six services;
  the `server` service's build step (`apps/cloud/vercel-build.sh`) compiles
  the launcher and then runs `launcher migrate`, which applies the
  migrations against the production database with the migrator role
  (`CLOUD_MIGRATOR_DATABASE_URL`) **before** the deployment goes live. A
  failed migration fails the build and the previous deployment keeps
  serving. The launcher refuses to migrate production unless
  `VERCEL_GIT_COMMIT_REF` is `main`, so a `vercel deploy --prod` from a
  feature branch fails its build instead of changing the production schema.
- **Previews:** every push to a pull request branch. The same build step
  migrates the preview database in the schema `pr_<number>` (branch name
  without a pull request: `br_<name>`), the function serves from that
  schema, and nothing is shared between previews except the database's
  extensions in `public`. See the configuration guide on Postgres schemas.
- **Startup never migrates:** the function starts the server without
  `--migrate` and refuses one.

`migrate` is idempotent: on a docs-only push it connects, finds nothing
pending and exits. Only commits that add migrations apply something, and
every migration must be expand/contract: the previous deployment keeps
serving until the new one is live, and a rollback promotes an older
deployment on the newer schema. The build script stamps version, commit and
date into the binary (`VERCEL_GIT_COMMIT_SHA` is not used; `apps/cloud/commit.txt`
is only written by manual deploys).

All services are rebuilt on every deploy. The Go step downloads the
toolchain and the modules each time and still takes well under a minute
plus the migration run; the whole deployment is bounded by the UI builds
(about 2.5 minutes on 2026-10-08, against 6 to 7 minutes with the earlier
container build).

### Manual and staged deploys

A `vercel deploy` from a workstation builds exactly the checked-out tree
and migrates like any other build: a preview deploy migrates the schema of
the local branch (`br_<name>`, or `pr_<n>` when the branch has a pull
request), a `--prod` deploy migrates production only when the local branch
is `main`. Write `git rev-parse HEAD > apps/cloud/commit.txt` first so the
binary reports the commit.

The serving function refuses `--migrate` (see `apps/cloud/launcher`), so
no deploy of any kind can change the schema by starting; only the build
step's explicit migrate run can.

### Rollback

Promote the previous deployment in the Vercel dashboard (Deployments → … →
Promote to Production) or `vercel promote <url>`; Vercel keeps every
deployment's functions. All services roll back together: they are one
deployment. A schema that the older binary cannot read is **not** rolled
back; that is what the expand/contract rule protects. To redeploy an older
commit with a build, run the workflow from that commit (`workflow_dispatch`
on a branch pointing at it).

## Lessons from the first deploy (2026-10-07)

- Service objects need an explicit `framework`. With `"framework": null`
  the build finishes in one second, builds nothing, and every path is a 404
  from the edge. The server ran as a `Dockerfile.vercel` container until
  2026-10-08 and now uses `"framework": "go"` with a `buildCommand`.
- The Vercel MCP connector could create the project but was refused (403)
  on environment variables; use `vercel env add NAME production,preview
  --sensitive --yes` with the value on stdin. A `--value` flag with an open
  stdin hangs the CLI after a successful add.
- This team stores new variables as **Secret** by default, so plain config
  added without a flag ends up unreadable in the dashboard. Pass
  `--no-sensitive` for config (`PORT`, `DOCS_SITE_URL`, …) and `--sensitive`
  only for real secrets (database URL, master key, bootstrap document).
- The team default Vercel Authentication (`all_except_custom_domains`) did
  not block the production alias `nextgen-preview-cloud.vercel.app`; it does
  protect preview and deployment URLs. Verify after any protection change.
- The published `1.0.0-alpha.24` does not have `/sessions/me/csrf`; the smoke
  test probes `/sessions/me` instead.
- Measured on the first deploy: build 13 s, cold start 3.7–5.3 s, warm
  `/readyz` 0.19 s, `POST /users` 0.23 s.
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
  a UI is enabled. With the UIs served as Vercel services, the container
  image carries a stub `index.html` per UI so the server boots and keeps the
  runtime endpoint; the stubs are shadowed by the route table. The clean
  fix is a server change: serve the runtime endpoint with both embedded UIs
  disabled (`console_enabled`/`login_enabled` false), then drop the stubs.
- Vercel's `--build-env` does not reach Docker `ARG`s (verified with a
  non-existent tag: the build still used the Dockerfile default). Anything
  the container build must know goes in as a file in the build context.
- A service object rejects `"framework": null`; with several frameworks
  detectable at the repo root (Vite, Storybook) every service must name its
  framework. Storybook builds with moon, so the upload must contain every
  moon project source (`tools/` stays out of `.vercelignore`); moon itself
  runs fine without a `.git` directory.
- The build log warns that the repo-root `api/` directory "will not be built
  because services are configured". That is Vercel's serverless-functions
  convention noticing a directory that is OpenAPI sources and Go code; the
  docs service reads `api/openapi` as files, nothing is lost.
- Without `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` the Console picked the oldest
  customer project as its standalone target, which was a local test project
  whose keys were wrapped with a discarded master key, so
  `/console/runtime.json` answered 500 (`enc_key.not_found`). The flag pins
  the Console to `proj_platform`. That stale `pg-smoke` row
  (`proj_01M4C6YJGKREDXW8XAC1PJVDZQ`) is still in the database and harmless;
  drop it when convenient.

## Operating

- **Logs:** Vercel runtime logs; container stdout is broadcast to all in-flight
  requests of the instance. Add a log drain for retention.
- **Cold starts:** instances scale to zero after 5 minutes without traffic.
  The cron in `vercel.json` hits `/readyz` every 5 minutes on the production
  deployment to keep one instance warm. Measure the cold start of the image
  after the first deploy; if it is unacceptable, shorten the cron.
- **Egress:** no static IP for container functions. The database is protected
  by TLS and the role password only.
- **Smoke test by hand:**

  ```sh
  corepack pnpm --filter @zitadel/cloud run smoke -- https://preview.zitadel.cloud
  ```

- **Staged production deploy:** `vercel deploy --cwd ../.. --prod --skip-domain`
  from `apps/cloud` builds with production settings without moving the
  production domain; smoke it with the project's protection-bypass header
  (`VERCEL_AUTOMATION_BYPASS_SECRET=… pnpm run smoke -- <url>`), then
  `vercel promote <url>`. Mind the migration rule above.

- **Master key rotation:** add a second key under a new `MASTER_KEY_ID`
  following ADR 029; this wrapper supports exactly one key per deployment
  today, so rotation needs a small extension of the launcher first.

## Known limits

- Vercel container images and the Fluid runtime: request and response bodies
  are capped at 4.5 MB, 1,024 file descriptors per instance, max duration
  per plan (300 s default).
- Scale-to-zero means in-process state (the request wide-event buffer of
  [ADR 048](../adrs/048-wide-events-internal-audit-primitive.md)) can be lost
  on scale-down; the server flushes on `SIGTERM` within Vercel's 30 s grace.
- No background job loop exists in this tree yet ([ADR 065](../adrs/065-background-jobs.md)
  is proposed). When it lands, scale-to-zero stalls periodic jobs while idle;
  the keep-warm cron covers that for a preview.
- Regions: one. Customer-chosen regions need the global layer described in
  the design note's Phase 4.
