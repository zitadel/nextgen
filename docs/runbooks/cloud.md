# Runbook: hosted cloud (Vercel + Neon)

> **Code:** [`apps/cloud/`](../../apps/cloud/) and the repo-root
> [`vercel.json`](../../vercel.json)
> **Vercel project:** `zitadel/nextgen-preview-cloud`
> **Neon project:** `nextgen` (organization "Vercel: zitadel", AWS
> `eu-central-1`)

The hosted cloud is the current `main`, built by Vercel from the repository
and run in Frankfurt (`fra1`) against a Neon Postgres database in the same
AWS region. **`main` is production:** every merge deploys. A pull request
that touches the server, the console or the login UI gets a preview
deployment with its own copy of the database. Version tags and their npm
packages remain the self-hosted artifact; this cloud does not run them.

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

- **Production** is the Neon `main` branch. The server serves from the
  pooled URL (`DATABASE_URL`, PgBouncer in transaction mode) with at most
  four connections per function instance, because Vercel starts one
  instance per concurrent request from cold. Migrations use the direct URL
  (`DATABASE_URL_UNPOOLED`): they hold a session advisory lock.
- **Previews** get a Neon branch `preview/<git branch>`, created by the
  integration from `main` on the branch's first preview deployment, with
  its URLs injected into that deployment only. The build migrates the
  branch; the database is otherwise production's data at the moment the
  branch was created.
- **Previews share production's data and master key.** Decided 2026-10-12
  for simplicity: a copied branch is only readable with the key that
  encrypted it. Previews stay within the team: their URLs sit behind
  Vercel Authentication, and a pull request from a fork deploys only after
  a team member approves it. A preview still runs its branch's code against
  a copy of production's data.
- **Cleanup:** Neon deletes a preview's branch when Vercel deletes the
  branch's last preview deployment, which follows the project's retention
  policy for preview deployments (Settings → Security → Deployment
  Retention Policy). Vercel never deletes the latest preview of a branch
  whose pull request is open, nor the 20 newest ready previews, so the
  branch of a merged pull request goes once it has aged out of both.

## One-time setup

### 1. Neon

In Vercel → Storage → `nextgen`:

1. **Plan:** the free plan to start. It caps the project at 10 branches
   (production plus nine previews at a time) and 100 compute hours a month
   shared by production and every preview; when the hours run out, the
   computes stay suspended until the month resets. Move to Launch (usage
   based) once either limit bites.
2. **Connect the project** `nextgen-preview-cloud` for Production and
   Preview. Under Advanced Options → Deployments Configuration turn on
   **Required → Preview** and **Resource must be active before
   deployment**. That is what creates a branch per preview.

### 2. Master key

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out master-key.pem
base64 < master-key.pem | tr -d '\n' > master-key.b64
```

Keep `master-key.pem` in the team password manager. Losing it makes every
project's key-encryption key unwrappable ([ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md)).

### 3. Vercel project

Settings: no Root Directory (the repository root holds `vercel.json`),
Node.js 24, production branch `main`, preview deployments on, Web Analytics
and Speed Insights enabled (their tabs in the project). Deployment
Protection stays on Vercel Authentication.

Environment variables (add secrets with
`vercel env add NAME production,preview --sensitive --yes`, value on stdin):

| Name | Target | Value |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*` | Production (previews get theirs per deployment) | set by the Neon integration; do not edit |
| `MASTER_KEY_PEM_B64` | Production, Preview; sensitive | contents of `master-key.b64`, the same key in both (see Database) |
| `MASTER_KEY_ID` | Production, Preview | a stable id such as `cloud-2026-10`; rotation adds a new id |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Production; sensitive; optional | a platform admin document (below) |
| `ENABLE_EXPERIMENTAL_COREPACK` | Production, Preview | `1`: the builds run package scripts that call `pnpm`, which must be the workspace's pinned version |
| `CLOUD_PRODUCTION_BRANCH` | Production; only while testing a pull request as production | the branch production deploys from; unset means `main` (see Deploying) |

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
  `CLOUD_PRODUCTION_BRANCH` (Production) to the same branch, and push. Every
  push then deploys production from that branch, **migrations included**:
  only test migrations this way that `main` will receive unchanged.
  Afterwards point the production branch back at `main` and delete
  `CLOUD_PRODUCTION_BRANCH`.
- **Previews:** every push to a branch, if
  [`ignore-build.sh`](../../apps/cloud/ignore-build.sh) finds a change to
  what the deployment runs since the branch's last preview, or since it
  left `main`. Docs-only branches get no preview.
- **Migrations must be expand/contract.** The previous deployment serves on
  the new schema until the new one is live, and Instant Rollback promotes
  an older deployment without touching the schema.
- **Startup never migrates:** the serving function refuses `--migrate`.

## Operating

- **Logs:** Vercel runtime logs of the `server` function (JSON). Add a log
  drain for retention.
- **Cold starts:** a Go instance boots in about a second. Neon suspends an
  idle compute after five minutes; the first query afterwards wakes it,
  which adds a few hundred milliseconds.
- **Connections:** four per instance through Neon's PgBouncer. A 0.25 CU
  compute allows 104 connections, of which the pooler uses up to 90 %.
  Raise the compute size before raising the pool size.
- **Analytics:** the console reports page views and Web Vitals per route
  pattern (`/ui/console/users/$userId`) to the project's Analytics and Speed
  Insights tabs.

## Later: read replicas in other regions

- Neon read replicas run in the primary's region only. A replica elsewhere
  means a second Neon project in that region fed by logical replication,
  which does not carry schema changes: migrations would have to run on
  both.
- The server has no read/write split yet; reads in another region need one
  before a replica helps.
- Vercel's Go preset ignores per-function regions. Pinning functions to a
  second region needs the Build Output API, as tried in the research PR
  [zitadel/nextgen#1518](https://github.com/zitadel/nextgen/pull/1518).
- Writes stay in Frankfurt. Nothing in this setup has to change to add a
  read path later.
