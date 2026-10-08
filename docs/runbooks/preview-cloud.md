# Runbook: preview cloud (Vercel + PlanetScale Postgres)

> **Status:** Draft (2026-10-07)
> **Code:** [`apps/cloud/`](../../apps/cloud/)
> **Design:** [preview-cloud-cloudflare-planetscale.md](../design/platform/preview-cloud-cloudflare-planetscale.md)

The preview cloud is the released `ghcr.io/zitadel/nextgen:<version>` image
running as a Vercel container in Frankfurt (`fra1`) against one PlanetScale
Postgres database in AWS `eu-central-1`. Production stays on GCP; this is a
single-region preview offering with the same topology as self-hosted.

The Vercel project is one deployment with three
[services](https://vercel.com/docs/services), defined in the repo-root
`vercel.json`:

| Service | Root | What it is | Public paths |
|---|---|---|---|
| `server` | `apps/cloud` | the container above | everything not listed below |
| `docs` | `apps/docs` | the docs site (Waku), built unchanged at base `/` | `/docs/*`, `/docs.md`, `/reference/*`, `/assets/*`, `/RSC/*`, `/api/search`, `/llms.txt`, `/llms-full.txt`, `/mcp/*` |
| `website` | `apps/website` | the website scaffold (Next.js), one start page | `/`, `/_next/*` |

The docs site serves its pages under `/docs` and `/reference` by itself, so
no base path is configured; the top-level rewrites only hand those prefixes
to the docs service. A new top-level path in the docs or website app (a
plugin route, a page, a file in `public/`) needs a rewrite here, otherwise
the server answers it with a 404. The server's own namespaces (`/projects`,
`/users`, `/sessions`, `/ui/console`, …) never overlap with the docs and
website prefixes. Once the website has real routes, move the server to its
own hostname (route by host in the same file) so the website can own every
path.

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
   | `NEXTGEN_DATABASE_POSTGRES` | `postgresql://preview-server…:5432/postgres?sslmode=verify-full&sslrootcert=system` | yes |
   | `MASTER_KEY_PEM_B64` | contents of `master-key.b64` | yes |
   | `MASTER_KEY_ID` | `preview-2026-10` (stable; rotation adds a new id) | no |
   | `PORT` | `8080` | no |
   | `NEXTGEN_SERVER_PUBLIC_BASE` | the public origin, e.g. `https://preview.zitadel.cloud` | no |
   | `NEXTGEN_INSTRUMENTATION_LOG_FORMAT` | `json` | no |
   | `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` | `true` | no |
   | `BOOTSTRAP_ADMIN_USER_JSON_B64` | output of `pnpm run admin-user` (see below) | yes |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (build time; the docs service installs with `corepack pnpm`, which pins the workspace's pnpm) | no |
   | `DOCS_SITE_URL` | the public origin, same as `NEXTGEN_SERVER_PUBLIC_BASE` (build time; canonical and sitemap URLs of the docs) | no |

   `PORT` is required: Vercel's container router defaults to 80 and the image
   runs as uid 65532, which cannot bind it.

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

Environment `preview-cloud` with:

| Kind | Name |
|---|---|
| secret | `VERCEL_TOKEN` (team token, deploy scope) |
| secret | `VERCEL_ORG_ID` |
| secret | `PREVIEW_CLOUD_VERCEL_PROJECT_ID` |
| secret | `PREVIEW_CLOUD_MIGRATOR_DATABASE_URL` (the `preview-migrator` role) |
| variable | `PREVIEW_CLOUD_PUBLIC_BASE` (same value as `NEXTGEN_SERVER_PUBLIC_BASE`) |

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

- **Automatic:** merge a change under `apps/cloud/`, `apps/docs/`,
  `apps/website/`, `api/openapi/` or to the root `vercel.json` to `main`.
- **Manual:** run `cloud-deploy` from the Actions tab.

Both run, in order: image existence check, `nextgen migrate` from the pinned
tag, `vercel deploy --prod`, smoke test. A failed migration stops the deploy.
`migrate` is idempotent: on a docs-only merge it connects, finds nothing
pending and exits; only a version bump applies migrations.

All services are rebuilt on every deploy. The server image build is about
15 s, the docs build a few minutes, the website under a minute; a docs-only
merge therefore also rolls the server to a new deployment of the same image.

### Bumping the server version

Edit the `ARG NEXTGEN_VERSION=` line in `apps/cloud/Dockerfile.vercel`
and open a PR. Every migration shipped between the old and new tag must be
expand/contract safe: for a short window both binaries serve traffic.

### Rollback

1. Revert the version bump PR, or run the workflow manually after setting
   the old version. The migrate step is idempotent and skips applied
   migrations. A schema that the old binary cannot read is **not** rolled
   back automatically; that is what the expand/contract rule protects.
2. For an instant switch without a build, promote the previous deployment in
   the Vercel dashboard (Deployments → … → Promote to Production). Server
   and docs roll back together: they are one deployment.

## Lessons from the first deploy (2026-10-07)

- `vercel.json` must say `"framework": "container"`. With `"framework": null`
  the build finishes in one second, builds nothing, and every path is a 404
  from the edge.
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
  production domain; smoke it with the project's protection-bypass header,
  then `vercel promote <url>`.

- **Master key rotation:** add a second key under a new `MASTER_KEY_ID`
  following ADR 029; this wrapper supports exactly one key per deployment
  today, so rotation needs a small extension of `entrypoint.sh` first.

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
