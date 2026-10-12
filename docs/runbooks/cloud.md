# Runbook: hosted cloud (Vercel + PlanetScale Postgres)

> **Code:** [`apps/cloud/`](../../apps/cloud/) and the repo-root
> [`vercel.json`](../../vercel.json)
> **Vercel project:** `zitadel/cloud` (renamed from `nextgen-preview-cloud`).
> Production answers at `nextgen-preview-cloud.vercel.app` and at
> `nextgen-docs-zitadel.vercel.app`, the docs' address that
> [`skills/zitadel/SKILL.md`](../../skills/zitadel/SKILL.md) gives agents,
> until a domain of our own is attached
> **PlanetScale:** organization `zitadel`, Postgres databases `production`
> and `preview`, both in AWS `eu-central-1`

The hosted cloud is the current `main`, built by Vercel from the repository
and run in Frankfurt (`fra1`) against PlanetScale Postgres in the same AWS
region. **`main` is production:** every merge deploys. A branch that touches
the server, the console, the login UI, the storybook or the docs gets a
preview deployment with a database of its own. Version tags and their npm
packages remain the
self-hosted artifact; this cloud does not run them.

## Layout

One Vercel deployment, four [services](https://vercel.com/docs/services):

| Service | Built by | Serves |
|---|---|---|
| `server` | Go preset; `apps/cloud/build.sh` builds the login UI the server embeds, compiles `apps/cloud/launcher`, then migrates | every path except the console's, the storybook's and the docs', including `/console/runtime.json` and the login UI at `/ui/login/` |
| `console` | Vite; the console build with `VITE_CONSOLE_VERCEL_INSIGHTS=1`, so it reports Vercel Web Analytics and Speed Insights | `/ui/console/*` (bare `/ui/console` redirects to the slash form) |
| `storybook` | Storybook; `moon run storybook:build`, moved to `dist/storybook/` | `/storybook/*` (bare `/storybook` redirects to the slash form) |
| `docs` | Next.js; `apps/docs`' own `pnpm run build`, never moon (moon cannot archive the symlinks Vercel's Next.js adapter writes) | `/docs` and `/docs/*`: pages, assets (`/docs/_next/`), search, `llms.txt`, each page's `.md` and the MCP server |

The console lives at the path the server would serve it from, on the same
origin. The server's own console is switched off, and nothing else about
the server changes: the session cookie, CSRF protection and the console
links the server derives all work as in a self-hosted install.

The storybook, the login surface's component workbench, is deployed only
here. Its orchestrator stories mock the API in the browser with a service
worker scoped to `/storybook/`, so the mock never answers for the console
or the login UI on the same origin.

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

### 2. Master keys and root admins

Each environment has a master key of its own and a root admin of its own,
both kept in 1Password. A preview runs pull request code; with its own key, a
preview never holds the key that unwraps production's data
([ADR 029](../adrs/029-cryptography-secrets-and-key-lifecycle.md)).

```sh
sh apps/cloud/setup-secrets.sh --email admin@zitadel.com production preview
```

[`setup-secrets.sh`](../../apps/cloud/setup-secrets.sh) mints, per
environment, an RSA 4096 master key with the id `cloud-<environment>-<year>-<month>`
and a root admin ([`admin-document.mjs`](../../apps/cloud/admin-document.mjs):
a random password, the bootstrap document with its PBKDF2 hash, the ids
`user_platformadmin` and `team_platformadmin` in the platform project), writes
them owner-only under `~/.zitadel/cloud/<environment>/`, and replaces the
three variables below for that environment on Vercel. With the 1Password CLI
on `PATH` and `OP_VAULT` set, it stores the key as a document item and the
login as a login item; otherwise store `master-key.pem` and `admin.json` by
hand. Losing a master key makes every project key of that environment
unwrappable; losing the admin password means a new document and, for
production, a password reset by hand.

The server imports the document on the next deployment and skips it once
the user exists, so the password 1Password holds stays valid. Every preview
database starts empty and imports the preview root admin on its first start:
one login opens every preview.

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
| `MASTER_KEY_PEM_B64` | Production; sensitive | production's `master-key.b64` (`setup-secrets.sh`) |
| `MASTER_KEY_PEM_B64` | Preview; sensitive | preview's `master-key.b64` |
| `MASTER_KEY_ID` | Production | production's `master-key.id`, `cloud-production-<year>-<month>` |
| `MASTER_KEY_ID` | Preview | preview's `master-key.id`, `cloud-preview-<year>-<month>` |
| `MASTER_KEY_PREVIOUS_PEM_B64` | Production or Preview; sensitive; only during a rotation | the key being rotated out, which `setup-secrets.sh --force` sets |
| `MASTER_KEY_PREVIOUS_ID` | Production or Preview; only during a rotation | its id |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Production; sensitive | production's `admin-user.b64`: the root admin document |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Preview; sensitive | preview's `admin-user.b64` |
| `ENABLE_EXPERIMENTAL_COREPACK` | Production, Preview | `1`: the builds run package scripts that call `pnpm`, which must be the workspace's pinned version |
| `CLOUD_PRODUCTION_BRANCH` | Production; only while testing a pull request as production | the branch production deploys from; unset means `main` (see Deploying) |

Database URLs take the form PlanetScale's Connect dialog gives,
`postgresql://<role>.<branch id>:<password>@<host>:<port>/postgres?sslmode=verify-full&sslrootcert=system`,
without pool parameters: the launcher adds them.

Every other variable is a leftover; delete it. `NEXTGEN_*` variables
override the launcher's defaults on purpose, so a stale one changes the
deployment.

The build parses everything the function needs to start (the master key,
its id, the serving URL, the admin document), so a variable that is missing
or garbled fails the build and the serving deployment stays.

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
  left `main`. A docs-only branch gets one too, database included, because
  the docs are a service of the deployment; SDK-only branches get none.
- **Migrations must be expand/contract.** The previous deployment serves on
  the new schema until the new one is live, and Instant Rollback promotes
  an older deployment without touching the schema.
- **Startup never migrates:** the serving function refuses `--migrate`.

## Deployment checks

Every deployment is tested once Vercel built it, on its own URL
(`cloud-<hash>-zitadel.vercel.app`, never a production alias):
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs on the
`deployment_status` event Vercel posts to GitHub and runs each service's
contract suite against the deployment, today the docs'
(`moon run docs:e2e-deployment`, [`apps/docs/AGENTS.md`](../../apps/docs/AGENTS.md)).
The check lands on the deployed commit, named after what it tested:
`deployment-checks / docs (Preview)` on the pull request,
`deployment-checks / docs (Production)` on `main`.

- The suites reach the protected deployment with the project's Protection
  Bypass for Automation secret, which the workflow expects as the repository
  secret `VERCEL_AUTOMATION_BYPASS_SECRET`. To set it from the project's
  settings without printing it:

  ```sh
  npx -y vercel@63.1.2 api "/v9/projects/cloud?teamId=team_IDtOs36TGPOejsKm40wr1p3C" \
    | jq -r '.protectionBypass | keys[0]' \
    | gh secret set VERCEL_AUTOMATION_BYPASS_SECRET --repo zitadel/nextgen
  ```

  Regenerating the secret in the project settings invalidates it: set it
  again.
- **Reading a red check**, in this order: the check's name says the service
  and the environment; its annotations name the failing contract (the test's
  title) and list every URL that failed; the run's summary names the
  deployment and the command that reproduces the run; the
  `docs-deployment-report` artifact holds the Playwright report and the
  traces.
- By hand, against any deployment:
  `DOCS_BASE_URL=https://cloud-….vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=… moon run docs:e2e-deployment`,
  or `gh workflow run deployment-checks.yml --ref <branch> -f url=https://cloud-….vercel.app`
  for a run without a new deployment. A change to the workflow needs no
  dispatch: a `deployment_status` run uses the file as it is on the deployed
  commit, so the branch's own preview checks it.
- Production is not held back by the check yet: a red run on `main` shows on
  the commit while the deployment already serves. To gate it, enable
  Deployment Checks in the project's Build & Deployment settings and select
  the `docs (Production)` check: Vercel then assigns the production domain only once the
  check passes, so a red deployment never replaces the one serving (Force
  Promote on the deployment's page bypasses it).

## Rotating the master key

The server re-wraps every project key to the current master key at startup
(`MigrateToLatestMasterKey`), as long as the key being rotated out is still
configured for decryption. The launcher renders both: the current key from
`MASTER_KEY_PEM_B64` and `MASTER_KEY_ID`, the previous one from
`MASTER_KEY_PREVIOUS_PEM_B64` and `MASTER_KEY_PREVIOUS_ID`.

1. `sh apps/cloud/setup-secrets.sh --force <environment>`: mints a new key,
   moves the old one to `~/.zitadel/cloud/<environment>/replaced-<time>/`
   and sets it as the previous key on Vercel. Store the new key in 1Password.
   The root admin is untouched; its password changes in the console.
2. Deploy: push, or redeploy the **current** deployment, never an older one,
   whose code may predate the schema. The first start re-wraps every project
   key; the launcher's log line names both keys.
3. Remove the previous key for that environment:
   `vercel env rm MASTER_KEY_PREVIOUS_PEM_B64 <environment> --yes`, the same
   for `MASTER_KEY_PREVIOUS_ID`. The next deployment runs on the new key only.

## Starting an environment over

Dropping an environment's data is the migrations' role's job: it owns the
schema, and PlanetScale's `postgres` role is neither a superuser nor a
member of it, so neither the dashboard console nor `postgres` can drop what
the migrations created. Connect as the migrations' role, whose connection
string is in Vercel, and run `DROP SCHEMA zitadel_nextgen CASCADE;`; for a
preview, drop its database (Database, cleanup) and the next build recreates
it. Run `setup-secrets.sh --force --new-admin <environment>` if the key or
the root admin should change as well, then deploy the current deployment:
the build migrates the empty schema, the first start seeds the platform
project and imports the root admin.

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
  pattern (`/ui/console/users/$userId`), the docs per page, to the project's
  Analytics and Speed Insights tabs.
- **Signing in:** `/ui/console/` with the environment's root admin from
  1Password (production and preview have different passwords). Anyone else
  registers through the login UI.

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
