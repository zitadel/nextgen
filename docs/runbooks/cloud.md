# Runbook: hosted cloud (Vercel + PlanetScale Postgres)

> **Code:** [`apps/cloud/`](../../apps/cloud/) and the repo-root
> [`vercel.json`](../../vercel.json)
> **Vercel project:** `zitadel/nextgen-preview-cloud`
> **PlanetScale:** organization `zitadel`, Postgres databases `production`
> and `preview`, both in AWS `eu-central-1`

The hosted cloud is the current `main`, built by Vercel from the repository
and run in Frankfurt (`fra1`) against PlanetScale Postgres in the same AWS
region. **`main` is production:** every merge deploys. A branch that touches
the server, the console or the login UI gets a preview deployment with a
database of its own. Version tags and their npm packages remain the
self-hosted artifact; this cloud does not run them.

## Layout

One Vercel deployment, two [services](https://vercel.com/docs/services):

| Service | Built by | Serves |
|---|---|---|
| `server` | Go preset; `apps/cloud/build.sh` builds the login UI the server embeds, compiles `apps/cloud/launcher`, then migrates | every path except the console's, including `/console/runtime.json` and the login UI at `/ui/login/` |
| `console` | Vite; the console build with `VITE_CONSOLE_VERCEL_INSIGHTS=1`, so it reports Vercel Web Analytics and Speed Insights | `/ui/console/*` (bare `/ui/console` redirects to the slash form) |

The console lives at the path the server would serve it from, on the same
origin. The server's own console is switched off, and nothing else about
the server changes: the session cookie, CSRF protection and the console
links the server derives all work as in a self-hosted install.

The launcher pins what follows from this layout (listen address from
`PORT`, console off at `/ui/console`, login UI on) and defaults the rest
(platform project bootstrapped, JSON logs, public base from Vercel's URL).
Any `NEXTGEN_*` variable overrides a default.

## Database

Two variables in both Vercel environments: `CLOUD_DATABASE_URL`, the pooled
URL (PgBouncer, port 6432) the server serves from with at most four
connections per function instance, because Vercel starts one instance per
concurrent request from cold; and `CLOUD_MIGRATOR_DATABASE_URL`, the direct
URL (port 5432) the build migrates through, because migrations hold a
session advisory lock.

- **Production** is the PlanetScale database `production`. Both URLs name
  its `postgres` database.
- **Previews** live on the separate PlanetScale database `preview`. Both
  URLs name its `postgres` database with a role that may create databases;
  the launcher swaps in the preview's own: one per Git branch, named
  `preview_<branch>_<hash>`
  ([`database.go`](../../apps/cloud/launcher/database.go)). The build
  creates it when it is missing, stamps it with the branch and the time of
  the deployment (a database comment), and migrates it; the function serves
  from it. Previews start empty and never see production data.
- **Cleanup** is not automated yet. The plan: drop preview databases whose
  stamp is older than 30 days. Until then, by hand on `preview`:

  ```sql
  SELECT datname, shobj_description(oid, 'pg_database') AS stamp
  FROM pg_database WHERE datname LIKE 'preview\_%' ORDER BY 2;
  DROP DATABASE "preview_…" WITH (FORCE);
  ```

## One-time setup

### 1. PlanetScale

Two Postgres databases in AWS `eu-central-1`, so production never shares a
cluster, a connection budget or an admin role with pull request code:

- **`production`**, highly available once anyone depends on it. Two roles
  on its `main` branch: one inheriting `pg_read_all_data` and
  `pg_write_all_data` for the running server, and one inheriting `postgres`
  for the migrations (they create extensions and the schema and set
  database options).
- **`preview`**, single node. One role inheriting `postgres`: it creates the
  preview databases, migrates them and serves from them. Postgres never
  passes the `CREATEDB` attribute on through membership, so the launcher
  creates a database as `postgres` when the role lacks the attribute itself.

### 2. Master key

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out master-key.pem
base64 < master-key.pem | tr -d '\n' > master-key.b64
```

Keep `master-key.pem` in the team password manager. Losing it makes every
project's key-encryption key unwrappable ([ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md)).
Previews may use a key of their own: their databases hold nothing of
production's.

### 3. Vercel project

Settings: no Root Directory (the repository root holds `vercel.json`),
Node.js 24, production branch `main`, preview deployments on, Web Analytics
and Speed Insights enabled (their tabs in the project). Deployment
Protection stays on Vercel Authentication.

Environment variables (add secrets with
`vercel env add NAME production --sensitive --yes`, value on stdin):

| Name | Target | Value |
|---|---|---|
| `CLOUD_DATABASE_URL` | Production; sensitive | `production`, the server's role, port 6432, database `postgres` |
| `CLOUD_MIGRATOR_DATABASE_URL` | Production; sensitive | `production`, the migrations' role, port 5432, database `postgres` |
| `CLOUD_DATABASE_URL` | Preview; sensitive | `preview`, its role, port 6432, database `postgres` |
| `CLOUD_MIGRATOR_DATABASE_URL` | Preview; sensitive | `preview`, its role, port 5432, database `postgres` |
| `MASTER_KEY_PEM_B64` | Production, Preview; sensitive | contents of `master-key.b64` |
| `MASTER_KEY_ID` | Production, Preview | a stable id such as `cloud-2026-10`; rotation adds a new id |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Production; sensitive; optional | a platform admin document (below) |
| `ENABLE_EXPERIMENTAL_COREPACK` | Production, Preview | `1`: the builds run package scripts that call `pnpm`, which must be the workspace's pinned version |
| `CLOUD_PRODUCTION_BRANCH` | Production; only while testing a pull request as production | the branch production deploys from; unset means `main` (see Deploying) |

Database URLs take the form PlanetScale's Connect dialog gives,
`postgresql://<role>.<branch id>:<password>@<host>:<port>/postgres?sslmode=verify-full&sslrootcert=system`,
without pool parameters: the launcher adds them.

Every other variable is a leftover; delete it. `NEXTGEN_*` variables
override the launcher's defaults on purpose, so a stale one changes the
deployment.

**Platform admin.** The platform project has no users until someone signs
up or a bootstrap document seeds one. Mint the document the way
`zitadel start` writes its local admin
([`admin-credential.ts`](../../apps/cli/src/lib/local-server/admin-credential.ts)),
set its ids, username and email to the cloud admin's, and add it base64
encoded. The server imports it on the next deploy and skips it afterwards.

## Deploying

- **Production:** every push to `main`. The `server` build migrates the
  production database **before** the deployment goes live. The launcher
  refuses to migrate production from any branch but the production branch
  (`CLOUD_PRODUCTION_BRANCH`, `main` when unset), so promoting a preview
  (which rebuilds with production variables) or a CLI `vercel deploy --prod`
  from a feature branch fails its build instead of changing the schema. A
  failed build leaves the previous deployment serving.
- **Testing a pull request as production** before it merges: point the
  project's production branch (Settings → Environments → Production →
  Branch Tracking) at the pull request's branch, set
  `CLOUD_PRODUCTION_BRANCH` (Production) to the same branch, and push a
  commit that changes a file: the project skips deployments of commits
  that change nothing ("Skip deployments when there are no changes to the
  root directory"), so an empty commit deploys nothing. Every push then
  deploys production from that branch, **migrations included**: only test
  migrations this way that `main` will receive unchanged.
  Afterwards point the production branch back at `main` and delete
  `CLOUD_PRODUCTION_BRANCH`.
- **A CLI deployment** (`vercel deploy` from a checkout) carries no Git
  metadata, so pass the branch and commit as build variables:
  `--build-env VERCEL_GIT_COMMIT_REF=<branch> --build-env VERCEL_GIT_COMMIT_SHA=<sha>`.
  The branch picks a preview's database and must match the production
  branch for a `--prod` deployment.
- **Previews:** every push to a branch, if
  [`ignore-build.sh`](../../apps/cloud/ignore-build.sh) finds a change to
  what the deployment runs since the branch's last preview, or since it
  left `main`. Docs-only branches get no preview.
- **Migrations must be expand/contract.** The previous deployment serves on
  the new schema until the new one is live, and Instant Rollback promotes
  an older deployment without touching the schema.
- **Startup never migrates:** the serving function refuses `--migrate`.

## Operating

- **Logs:** Vercel runtime logs of the `server` function (JSON). The
  launcher's first line names the database host and database it serves
  from. Add a log drain for retention.
- **Cold starts:** a Go instance boots in about a second; a burst from cold
  starts one instance per concurrent request.
- **Connections:** four per instance through PlanetScale's PgBouncer, which
  pools per database and role: on `preview` every preview database is a
  pool of its own, so the cluster's `max_connections` bounds how many
  previews can be busy at the same time. Raise it (Parameters tab, needs a
  restart) before raising the pool size.
- **Analytics:** the console reports page views and Web Vitals per route
  pattern (`/ui/console/users/$userId`) to the project's Analytics and Speed
  Insights tabs.

## Later: read replicas in other regions

- PlanetScale Postgres adds read replicas in other regions of the same
  cloud provider, asynchronous, with a host of their own.
- The server has no read/write split yet; reads in another region need one
  before a replica helps.
- Vercel's Go preset ignores per-function regions. Pinning functions to a
  second region needs the Build Output API, as tried in the research PR
  [zitadel/nextgen#1518](https://github.com/zitadel/nextgen/pull/1518).
- Writes stay in Frankfurt. Nothing in this setup has to change to add a
  read path later.
