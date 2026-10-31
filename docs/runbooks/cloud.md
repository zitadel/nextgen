# Runbook: hosted cloud (Vercel + PlanetScale Postgres)

> **Code:** [`apps/cloud/`](../../apps/cloud/) and the repo-root
> [`vercel.json`](../../vercel.json)
> **Vercel project:** `zitadel/cloud` (renamed from `nextgen-preview-cloud`).
> Production answers at `preview.zitadel.com`, the docs' address that
> [`skills/zitadel/SKILL.md`](../../skills/zitadel/SKILL.md) gives agents;
> `nextgen-preview-cloud.vercel.app` and `nextgen-docs-zitadel.vercel.app`
> redirect there
> **PlanetScale:** organization `zitadel`, Postgres databases `production`
> and `preview`, both in AWS `eu-central-1`

The hosted cloud is the current `main`, built by Vercel from the repository.
The server runs in Frankfurt (`fra1`) against PlanetScale Postgres in the
same AWS region; the docs' and website's functions run in the five regions
of `vercel.json`'s top-level `regions`, Pro's limit, and the static services
from Vercel's CDN. **`main` is production:** every merge deploys. Every other branch
gets a preview deployment with a database of its own, except the Changesets
version PR's and the merge queue's (see [Deploying](#deploying)). Version
tags and their npm packages remain the self-hosted artifact; this cloud does
not run them.

## Layout

One Vercel deployment, six [services](https://vercel.com/docs/services):

| Service | Built by | Serves |
|---|---|---|
| `server` | Go preset; the build command installs, because Vercel's Go builder runs no `installCommand`, and then runs `node_modules/.bin/turbo run deploy --filter=@zitadel/cloud`. turbo goes by its path because, unlike the JS builders, the Go builder puts no `node_modules/.bin` on `PATH`. `@zitadel/cloud`'s `build` compiles `apps/cloud/launcher` without the console (`-tags noconsole`), then `migrate` migrates and `deploy` hands the binary to the preset, none of them cached | `/api/*`, the API, and every path except the console's, the docs', the website's, the cloud functions' and the Mixpanel proxy's, including `/console/runtime.json` |
| `console` | Vite; `turbo run build` with `CONSOLE_BASE_PATH=/console/` and `CONSOLE_ADDON=../cloud-console`, which compiles in the cloud's add-on ([`apps/cloud-console`](../../apps/cloud-console/AGENTS.md)): it reports Vercel Web Analytics and Speed Insights, adds the unlisted sign-up page `/console/signup`, and adds Billing and Support to Settings, which until their systems are live say the cloud is free during the preview and point to GitHub issues, starts onboarding on each signed-in page and on the CLI's claim page, and reports `signup_completed` when the sign-in widget makes an account; in previews it also adds Email and sends the sign-in widget's calls through BotID's check in `cloud-functions`; the service serves the build where it lands, `internal/staticui/console/dist` | `/console/*` (bare `/console` redirects to the slash form; `/ui/console` and `/ui/console/*` redirect here with a 307) |
| `docs` | Next.js; `turbo run build --filter=@zitadel/docs`, after `@zitadel/components`, `@zitadel/api-mock` and the `@zitadel/api` client the mock calls, which the live examples render, and the docs' typecheck. The build's cache key holds the deployment's ID, which Skew Protection bakes into it, so it never comes from the cache; never moon, which cannot archive the symlinks Vercel's Next.js adapter writes | `/docs` and `/docs/*`: pages, assets (`/docs/_next/`), search, `llms.txt`, each page's `.md` and the MCP server |
| `website` | Next.js; `turbo run build --filter=@zitadel/website`, after the atoms of `@zitadel/components` its showcase renders; keyed by the deployment's ID, as the docs' | `/`, the front page, `/changelog` (`/changelog/` redirects there) with its entries' pages and its feed under it, `/changelog/*`, and their assets at `/_next/*`; the host's `/llms.txt`; the host's favicons at `/favicon.ico` and `/favicons/*`, which the console, the login UI and the docs link |
| `cloud-functions` | Next.js; `turbo run build --filter=@zitadel/cloud-functions`, route handlers and the Workflow SDK's routes, no pages ([`apps/cloud-functions`](../../apps/cloud-functions/AGENTS.md), [ADR 084](../adrs/084-hosted-cloud-business-systems.md)); keyed by the deployment's ID, as the website's. It reads Zitadel live; Stripe and HubSpot are mocks, which send nothing. Production runs onboarding on them and answers everything else `503 cloud.not_live` | `/cloud/*`: the console add-on's calls (`/cloud/api/*`), the sign-in widget's calls through BotID's check (`/cloud/zitadel/*`), Stripe's webhooks (`/cloud/hooks/stripe`) and its cron routes (`/cloud/cron/*`, none scheduled yet) |
| `schemas` | Static files: `turbo run schemas --filter=@zitadel/cloud` renders them with [`scripts/render-builtin-schemas.mjs`](../../scripts/render-builtin-schemas.mjs) into `apps/cloud/dist/cloud-schemas`. The service is rooted at `apps/cloud`, whose `package.json` has no dependencies, so Vercel detects no framework: a service takes no `framework: null`, and a framework dependency there would change how it builds | `/schemas/v1/*`: the [built-in schemas](#built-in-schemas), as `application/schema+json`, fresh for an hour and readable from any origin |

The console lives on the same origin, at `/console/` rather than a
self-hosted server's `/ui/console/`. The server's own console is switched
off and its console path set to `/console`, so the console links it derives
(claim, dashboard) point there; the session cookie and CSRF protection work
as in a self-hosted install. The function does not carry the console either:
the console service's build lands in the server's embed directory of the
same checkout, so `build-launcher.sh` compiles the launcher with `-tags noconsole`.
The server's `/console/runtime.json` lies under the console's path, so its
rewrite comes first in `vercel.json`, and a launcher test holds the mount,
the build's base and the console path together.

`/api/*` is the API's ([ADR 077](../adrs/077-api-path-prefix.md)): its
rewrite to the server comes first, so no service can take a path under it.
Until 1.0.0 the server also answers the API's root paths, with a
`Deprecation` header, through the catch-all.

`/telemetry/mixpanel/*` belongs to no service: a rewrite forwards it to
Mixpanel's EU API, `api-eu.mixpanel.com`. The CLI's usage analytics and
the server's service ping send to Mixpanel through it once Mixpanel is no
longer paused: keep it, ahead of the server's catch-all.

The docs' live examples mock the flow API in the browser with a service
worker scoped to `/docs/`, so the mock never answers for the console on the
same origin.

Every service shares the origin, and with it a signed-in user's session, so
each response carries security headers:

- `vercel.json`'s top-level `headers` reach every service's responses (not
  its own redirects): `nosniff`, `Referrer-Policy`, `X-Frame-Options` and a
  `Permissions-Policy` disabling camera, microphone and geolocation.
  Passkeys and clipboard remain available.
- Each service sends its own Content-Security-Policy: the console's enforced
  and report-only policies in its service's `headers` (a server test holds
  them to the server's policy for the same page, plus Vercel's toolbar), the
  docs' and the website's from their `next.config` and, per prerendered page,
  their build adapter (`csp-adapter.mjs`), the server's from the Go code.
  Violations go to the server's `/csp-report`.
- The console's enforced policy covers inline script. The docs' and the
  website's enforced policies list each prerendered page's inline scripts by
  hash. Every other URL gets the prerendered 404's policy, so the 404
  hydrates; unknown docs slugs reach that 404, in the docs layout.
- HSTS is Vercel's default: zitadel.com is on the preload list with its
  subdomains, so the cloud's host needs no `includeSubDomains` or `preload`
  of its own.

The launcher pins what follows from this layout (listen address from
`PORT`, console off with its links at `/console`) and defaults the rest
(platform project bootstrapped, JSON logs, public base from Vercel's URL).
Any `NEXTGEN_*` variable overrides a default. The URLs Vercel serves a
deployment at are added to `NEXTGEN_SERVER_CONSOLE_ORIGINS`, never replaced
by it.

## Built-in schemas

The server names its built-in schemas (the user schema, the flow definition,
the IdP connection, branding and the documents they `$ref`) by URL under its
`schema.builtin_public_base`, `https://zitadel.com/schemas/v1`. The base is
an identifier namespace: the server resolves these documents from the copies
it embeds and never fetches them. The `schemas` service publishes each
document for editors and people under the same path on this project:
`/schemas/v1/user-schema.json` answers with the document whose `$id` is
`https://zitadel.com/schemas/v1/user-schema.json`.

- **The build** renders every file in `api/openapi/endpoints/schemas/` the
  way the server renders it for its own validator
  (`domain.WriteBuiltinJSONSchema`): `$id` set to the document's URL, every
  relative `$ref` resolved against it, nothing else changed. It fails when a
  `$ref` names a document under the base that is no built-in, so an editor
  that follows one never meets a 404. The renderer is Node rather than the
  server's Go because only a Go service's build has a Go toolchain on Vercel,
  and the services build in no fixed order. A change to one renderer belongs
  in the other.
- **The routes:** the top-level rewrite sends `/schemas/v1/*` to the service,
  ahead of the server's catch-all; a name that is no built-in is the
  service's 404. The API keeps `/api/v1/schemas` and `/api/v1/schemas/{id}`,
  and until 1.0.0 `/schemas` and `/schemas/{id}`: a schema id never holds a
  slash.
- **zitadel.com** answers for the namespace itself by forwarding
  `/schemas/v1/:path*` to this project, or by running
  `node scripts/render-builtin-schemas.mjs` in its own build. Until it does,
  the identifiers do not resolve, which nothing in the product needs.
- **Previews** serve the same documents. One fetched from
  `cloud-….vercel.app` still says it is
  `https://zitadel.com/schemas/v1/<name>`, and its `$ref`s lead there.
- **Versions:** through alpha, `/schemas/v1/` serves main's latest, while
  editors validate against the copies `zitadel setup` writes into a project's
  `.zitadel/meta/`. What `v1` promises across releases is decided before 1.0
  ([schema versioning](../design/schema-engine/versioning.md#published-copies)).
- **Changing the namespace** means changing `HOSTED_BASE` in the renderer
  together with the server's default base (the renderer's tests hold the two
  equal) and adding the new base to `domain.KnownBuiltinSchemaBases`, so every
  identifier minted under an earlier one keeps resolving.

## Database

Two variables in both Vercel environments: `CLOUD_DATABASE_URL`, the pooled
URL (PgBouncer, port 6432) the server serves from with at most four
connections per function instance, because a burst starts new instances
and each holds its own, while the four are shared by every request the
instance has in flight ([Operating](#operating)); and
`CLOUD_MIGRATOR_DATABASE_URL`, the direct URL (port 5432) the build
migrates through, because migrations hold a session advisory lock.

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
- **Cleanup:** [`preview-cleanup.yml`](../../.github/workflows/preview-cleanup.yml)
  drops a branch's database once its pull request from this repository
  merges (`launcher drop-preview <branch>`), and every day each database
  whose stamp is older than 30 days (`launcher drop-preview --idle-days
  30`). That sweep also takes an open pull request nobody pushed to for
  30 days; its next push starts it empty. A database without a stamp's
  deployment time is kept and logged, and so is one a deployment stamps
  while the sweep runs. The branch's preview deployments
  stay up, without a database.
  - **By hand:** run the workflow from the Actions tab. It lists what the
    sweep would drop; tick *Drop* to drop it.
  - **The secret:** the workflow expects the repository secret
    `CLOUD_PREVIEW_MIGRATOR_DATABASE_URL`: a role of the PlanetScale
    database `preview` (whose `main` PlanetScale calls a production
    branch) that inherits `postgres`, its database `postgres`, port 5432,
    as Vercel's **Preview** `CLOUD_MIGRATOR_DATABASE_URL` is. Never
    production's: the launcher refuses a URL whose database holds the
    server's schema, as production's does. Set it with `gh secret set
    CLOUD_PREVIEW_MIGRATOR_DATABASE_URL --repo zitadel/nextgen`, which
    prompts for the value.
  - **Ownership:** only a database's owner, or a role that inherits it, may
    drop it. The launcher creates preview databases as `postgres`, so any
    role inheriting `postgres` can. One the builds' role created as itself,
    before the launcher did that, only that role can, until the dashboard's
    *Reassign objects* on it (Settings, Roles) hands its databases to
    `postgres`; the builds keep working, as they inherit `postgres`.
  - **One database by hand,** on `preview`:

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
- **`preview`**, single node. One role inheriting `postgres`
  (`vercel-preview-migrator`): it creates the preview databases, migrates
  them and serves from them. The launcher creates each as `postgres`, which
  then owns it, so the cleanup's role can drop it (Database, cleanup);
  without `CREATEDB` of its own the role still may, as `postgres` has it.

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

The launcher names the root admin (the document's `header.id`) the
deployment's platform operator, who administers every project
([ADR 075](../adrs/075-platform-operators.md)), and refuses to start with a
document that names no user id.
To name others, such as support staff, set `NEXTGEN_PLATFORM_OPERATORS` to
their platform-project user ids, comma-separated and the root admin included;
the server grants and revokes to match at its next start.

### 3. Vercel project

Settings: no Root Directory (the repository root holds `vercel.json`),
Node.js 24, production branch `main`, preview deployments on, Web Analytics
and Speed Insights enabled (their tabs in the project), Cron Jobs enabled
(the [event retention](#operating) purge runs from one). Deployment
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
| `CRON_SECRET` | Production; sensitive | `openssl rand -hex 32`, kept in 1Password: the token the [event retention](#operating) cron job sends the server; the build fails without it |
| `CRON_SECRET` | Preview; sensitive | another one: a preview's build fails without it too, although no cron job runs there; it starts a run on a preview by hand |
| `CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE` | Production, Preview | `0.01`: the share of console page loads that send Speed Insights, `0` to `1`; unset sends every one |
| `DOCS_SPEED_INSIGHTS_SAMPLE_RATE` | Production, Preview | `0.01`: the same for the docs |
| `WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE` | Production, Preview | `0.01`: the same for the website |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Production; sensitive | production's `admin-user.b64`: the root admin document |
| `BOOTSTRAP_ADMIN_USER_JSON_B64` | Preview; sensitive | preview's `admin-user.b64` |
| `NEXTGEN_PLATFORM_OPERATORS` | Production or Preview; optional | the platform operators' user ids, comma-separated; unset means the root admin alone |
| `ENABLE_EXPERIMENTAL_COREPACK` | Production, Preview | `1`: the builds run package scripts that call `pnpm`, which must be the workspace's pinned version |
| `TURBO_TELEMETRY_DISABLED` | Production, Preview | `1`: turbo sends no telemetry from the builds, as in CI |
| `TURBO_PLATFORM_ENV_DISABLED` | Production, Preview | `1`: stops turbo listing, under every task, each project variable `turbo.json` does not pass; the JS builds are not meant to see them (strict environment mode) |
| `CLOUD_PRODUCTION_BRANCH` | Production; only while testing a pull request as production | the branch production deploys from; unset means `main` (see Deploying) |

The cloud functions read no Stripe or HubSpot key yet: their systems are
mocks ([ADR 084](../adrs/084-hosted-cloud-business-systems.md) §9), and each
live adapter adds its variables to this table. Two project settings serve
them already: "Automatically expose System Environment Variables" stays on,
since the Workflow SDK picks Vercel's world from `VERCEL_DEPLOYMENT_ID`, and
Protection Bypass for Automation gives a preview's functions
`VERCEL_AUTOMATION_BYPASS_SECRET`, which their calls to the preview's own
server carry.

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
- **Previews:** every push to any other branch, docs-only and SDK-only
  branches included. There is no skip step: Vercel does not run a
  service's `ignoreCommand`, and most branches touch something the
  deployment builds from anyway.
- **The Changesets version PR gets no preview.** `git.deploymentEnabled`
  in `vercel.json` turns off deployments of `changeset-release/*`, so
  Vercel starts none. `release-publish.yml` force-pushes that branch after
  most merges to `main`, and it only bumps versions and changelogs: a
  preview would differ from production in the server's version string
  alone. Once merged, the release builds as production and runs
  production's [deployment checks](#deployment-checks).
- **The merge queue gets no preview.** The queue tests each pull request
  on a temporary branch, `gh-readonly-queue/main/pr-<number>-<sha>`, and
  `git.deploymentEnabled` turns off deployments of `gh-readonly-queue/**`
  (a single `*` would stop at the branch's second `/` and match nothing).
  The pull request already has its preview, and the commit the queue lands
  on `main` deploys as production. A preview per queue branch would build
  every service again and leave one more database behind for every
  queued pull request.
- **Migrations must be expand/contract.** The previous deployment serves on
  the new schema until the new one is live, and Instant Rollback promotes
  an older deployment without touching the schema.
- **Startup never migrates:** the serving function refuses `--migrate`.
- **The server's defaults must be expand/contract too.** The platform project
  is deployed from them on every start, and a new deployment's checks start it
  before the production domains move, so the previous deployment serves the
  new defaults. Instant Rollback keeps them: a server never replaces a
  deployment a newer build made. A default that turns out wrong is fixed by
  shipping a corrected one.

## Deployment checks

Every deployment is tested once Vercel built it, on its own URL
(`cloud-<hash>-zitadel.vercel.app`, never a production alias):
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs each
service's contract suite against the deployment, today the docs'
([`apps/docs/AGENTS.md`](../../apps/docs/AGENTS.md)), the console's
([`e2e/console/README.md`](../../e2e/console/README.md)) and the built-in
schemas' ([`e2e/schemas/`](../../e2e/schemas/)), and on a preview the CLI's
([`e2e/cli/`](../../e2e/cli/)), as the turbo tasks
`pnpm check:cloud` runs [by hand](#checking-a-deployment-by-hand). The console's
signs nobody in: it checks how `vercel.json` routes the console's paths, the
API's prefix and the Mixpanel proxy, and that the signed-out console comes up, down to the login widget's first step,
which needs the server and its database behind it. The schemas' fetches every
built-in from `/schemas/v1/` and compares it with the deployed commit's own
rendering, checks the headers `vercel.json` gives them, and that
`/api/v1/schemas`, and until 1.0.0 `/schemas`, reach the API; it needs no
browser. The CLI's packs this commit's
CLI, as `release:pack` does, and drives it with `--non-interactive --json`
from an empty directory: `setup --server <deployment>` creates a project,
then `deploy`, `variable set` and `list`, `origin add` and `list`,
`deployment list` and `rollback` run on it, and a browser signs up on the
console to finish the `claim` the CLI starts. Each run leaves that project in
the deployment's database, so only previews run it, and it skips the
production domain. The CLI never holds the bypass secret: it reaches the
deployment through a local proxy, as through a company's TLS-inspecting one,
that adds it ([`bypass-proxy.ts`](../../e2e/cli/support/bypass-proxy.ts)).
What starts it, and where the result lands, depends on the environment:

- **A preview:** the `deployment_status` event Vercel posts to GitHub. The
  checks land on the pull request: `deployment-checks / docs (Preview)`,
  `deployment-checks / console (Preview)`,
  `deployment-checks / schemas (Preview)` and
  `deployment-checks / cli (Preview)`.
- **Production:** [`production-checks.yml`](../../.github/workflows/production-checks.yml),
  on the `vercel.deployment.ready` dispatch Vercel sends once the deployment
  is built, before its Deployment Checks run. It calls the same jobs and sets
  one commit status per suite on the deployed commit, `docs (Production)`,
  `console (Production)` and `schemas (Production)`; the CLI's suite does
  not run. A deployed commit from
  before the schemas service passes the last with nothing to check. A dispatch runs the workflow as it is on `main`: a
  change to it takes effect once merged.
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
- **Nothing uploaded may hold a secret:** the repository is public, so
  anyone signed in to GitHub can download a run's artifacts. Against a
  deployment a suite records no traces and writes no HTML report, and the
  workflow uploads its screenshots alone: a trace holds every request's
  headers, the bypass secret among them, and so does the error of a request
  that failed, which `error-context.md` and the HTML report keep. A
  screenshot holds what the page shows, so a test whose page shows a secret
  turns screenshots off. The errors reach the log and the annotations, where
  GitHub masks the repository's secrets; it masks a secret the suite mints at
  runtime, such as a session token, only once the job registers it
  (`::add-mask::`). A suite added later, the server's too, follows the same
  rule.
- **Reading a red check**, in this order: the check's name says the service
  and the environment (production's status links its run); its annotations
  name the failing contract (the test's title) and list every URL that
  failed; the run's summary names the deployment and the command that
  reproduces the run; a failed browser test's screenshots are the
  `docs-deployment-screenshots`, `console-deployment-screenshots` or
  `cli-deployment-screenshots` artifact (the schemas' suite runs no browser
  and uploads nothing). The CLI's annotations quote what the failing command
  printed.
  A flaky production run is run
  again from that run's page: it reports on the same commit again.
- `gh workflow run deployment-checks.yml --ref <branch> -f url=https://cloud-….vercel.app`
  runs the workflow without a new deployment; it reports `docs (dispatch)`,
  `console (dispatch)` and `schemas (dispatch)`, never production's statuses,
  and with `-f cli=true` `cli (dispatch)`: only for a preview's URL. A change to
  `deployment-checks.yml` needs no dispatch: a `deployment_status` run uses
  the file as it is on the deployed commit, so the branch's own preview
  checks it.
- **Holding production back on it:** in the project's Build & Deployment
  settings, Deployment Checks, add the GitHub checks `docs (Production)`,
  `console (Production)` and `schemas (Production)` and let them block. Vercel then assigns the
  production domains only once the statuses pass, so a red deployment never
  replaces the one serving (Force
  Promote on the deployment's page bypasses it). Until then a red status
  only shows on the commit while the deployment already serves. A check
  added there has to come from `production-checks.yml`: one that starts on
  `deployment_status` waits for the very domains it holds back.

### Checking a deployment by hand

`pnpm check:cloud` runs every deployment suite from a checkout against the
deployment `CLOUD_URL` names: the turbo tasks the workflow runs, side by side,
and on past a suite that fails, so one run says what works and what does not.
The production domain is public; any other URL of the project, a preview's or
a deployment's own, needs the bypass secret:

```sh
corepack pnpm --filter @zitadel/e2e exec playwright install chromium   # once
CLOUD_URL=https://preview.zitadel.com pnpm check:cloud

export VERCEL_AUTOMATION_BYPASS_SECRET="$(npx -y vercel@63.1.2 api "/v9/projects/cloud?teamId=team_IDtOs36TGPOejsKm40wr1p3C" | jq -r '.protectionBypass | keys[0]')"
CLOUD_URL=https://cloud-….vercel.app pnpm check:cloud
```

`--filter=@zitadel/docs` runs the docs' suite, `--filter=@zitadel/e2e` the
console's, the schemas' and the CLI's; a red check's summary names the command
that runs its suite alone. The CLI's suite skips the production domain; never
point it at a production deployment's own URL, where it would leave a project
in production's database. A new suite is a turbo task that
`check:cloud` lists, a job in `deployment-checks.yml` and, unless it writes to
the deployment as the CLI's does, a status in `production-checks.yml`'s
`SUITES`.

## Running the cloud locally

`pnpm run cloud` (`moon run workspace:cloud`) runs this deployment at
http://localhost:3000: `vercel dev -L` over `vercel.json`, every service behind
the deployment's own routes on one origin, the server on SQLite. No Vercel
account, link or secret is involved, and Go need not be installed: Vercel's Go
builder downloads the version `go.mod` names. `CLOUD_DEV_PORT` moves the port;
`CLOUD_DEV_DEBUG=1` shows why a service did not start, which `vercel dev` logs
only at debug level.

[`scripts/run-cloud.mjs`](../../scripts/run-cloud.mjs) builds what the
services read from disk (the packages the console's and the docs' builds
import, the docs' generated sources), mints a throwaway master key and root
admin under `.zitadel/local/cloud/` on the first run, and starts
`vercel dev`. Sign in to `/console/` with the login in
`.zitadel/local/cloud/admin.json`. The SQLite database lives beside it, so a
restart keeps its state; deleting the directory starts over.

`vercel dev` reads `vercel.json` and nothing else (it ignores
`--local-config`), so what it needs lives there, in fields a deployment does
not use:

- The `server` service's `entrypoint` names `apps/cloud/launcher`. In dev,
  Vercel's Go builder builds that package and starts it on `$PORT`; a
  deployment's build command compiles the same package through turbo, and
  the builder takes that binary instead. Without
  `CLOUD_DATABASE_URL` and outside a deployment, the launcher serves from
  SQLite and migrates it at startup.
- The `console` service's `devCommand` builds it with the add-on
  (`CONSOLE_ADDON`), as a deployment's build command does, and serves the
  build behind the same service rewrites a deployment serves it behind. Its dev server
  cannot sit behind those rewrites, so its live loop stays
  `moon run console:dev-real`. `NODE_ENV` is set because `vercel dev` runs dev
  commands under `development`, which makes `vite build` a development build.
- The `schemas` service's `devCommand` renders the built-in schemas and serves
  them (`--serve`): `vercel dev` wants a dev server for every service, a
  static one too, and refuses to start without one.
- The console's fallback to its `index.html` leaves `assets/` out. `vercel dev`
  cannot see a service's files, so a fallback for every path would answer the
  console's scripts with the page. A deployment answers a missing asset with a
  404 instead of the page.

The docs and the website run `next dev`. `.vercelignore` keeps `vercel dev`
from watching what no deployment is built from, the desktop app's worktrees
among them, and keeps a CLI deployment from uploading it.

In a desktop-app worktree, which sits in the main checkout's
`.claude/worktrees/`, it runs the worktree's `vercel.json` and services.
`vercel dev` runs the nearest folder above the one it is given that holds a
`vercel.json`, `.vercel` or `.git`, if that `vercel.json` has services: given
a worktree's root, the main checkout. The script gives it `scripts/`.
`CLOUD_DEV_DEBUG=1` logs the folder it runs as `Running from project root:`;
in a worktree a second such line names the main checkout, where the CLI only
looks for a `vercel link`.

Where it differs from a deployment:

- `vercel dev` drops a redirect's query, so an old
  `/ui/console/claim?challenge_id=…` link arrives without its challenge; open
  `/console/claim?…` instead.
- `CLOUD_URL=http://localhost:3000 pnpm check:cloud` runs the deployment
  checks against it. Three fail by design: the redirect's query above; the
  docs' assets, which `next dev` serves without the deployment's immutable
  caching; and the schemas' headers, which `vercel dev` replaces with its own
  (`application/json`, revalidated on every request).
- Services is a beta of the Vercel CLI, and `vercel dev` changes from one
  major to the next. The script drives a `vercel` on `PATH` of the major it
  pins and otherwise runs the pinned version through npx; its first lines say
  which.

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

- **Onboarding runs:** each signed-in person, and each CLI sign-up on its
  claim page, starts `provision-crm`, and `provision-billing` for a team
  without a Stripe customer. A contact `provision-crm` makes or takes over
  carries the sign-up's source in its `signup_*` properties (ADR 084 §3).
  Their steps return the HubSpot and Stripe calls they would make, which
  nothing sends yet: read them in Vercel → Observability → Workflows, a run, then Decrypt
  (permission to read the project's environment variables). From
  `apps/cloud-functions`, with the Vercel CLI linked:
  `npx workflow inspect runs --backend vercel --env preview --decrypt`, or
  `--env production`. The log lines start `hubspot (mock, not sent)` or
  `stripe (mock, not sent)`.
- **Sign-ups by source:** Web Analytics → Events → `signup_completed`, or
  with the Vercel CLI, grouping by `eventData/utm_source`, `eventData/page`
  (`claim` is the CLI) or `eventData/referrer_host`:
  `npx -y vercel@64.5.0 api "/v1/query/web-analytics/events/aggregate?projectId=cloud&teamId=team_IDtOs36TGPOejsKm40wr1p3C&since=<date>&until=<date>&by=eventData/utm_source&filter=eventName%20eq%20%27signup_completed%27"`.
  The browser sends it, so a blocker drops a sign-up as it drops page views;
  the contacts' `signup_*` count every sign-up that reached onboarding.
- **Logs:** Vercel runtime logs of the `server` function (JSON). The
  launcher's first line names the database host and database it serves
  from. Add a log drain for retention. A line's `request_id` is Vercel's
  Request ID for the request (the launcher sets `server.request_id_header`
  to `x-vercel-id`), the one an error page and `X-Request-Id` quote: search
  for it. On a protected preview the response's `x-vercel-id` names an outer
  hop that Vercel does not log; search for `X-Request-Id` instead.
- **Errors:** Vercel tags every line of the Go function `info`, whatever
  stream it is written to and whatever its `level` field says, Vercel's own
  crash messages included, so the dashboard's level filter finds no error.
  Find a failed request by its status instead, then read its lines by its
  request ID (the `requests` source needs Vercel CLI 64 or newer):

  ```sh
  npx -y vercel@64.5.0 logs requests --scope team_IDtOs36TGPOejsKm40wr1p3C \
    --project cloud --environment production --since 24h --query 'httpStatus>=500'
  npx -y vercel@64.5.0 logs --scope team_IDtOs36TGPOejsKm40wr1p3C \
    --project cloud --since 24h --query 'requestId:"<request id>"'
  ```

  A server that fails to start shows up the same way: the request that
  started the instance answers 500, and its lines end with the launcher's
  error and `the user server exited during startup`. An error outside a
  request, such as a failed flush of the request audit events, has no
  status to find it by: search the messages for the word, which also
  matches the 4xx `api error` lines, and keep the `ERROR` ones:

  ```sh
  npx -y vercel@64.5.0 logs --scope team_IDtOs36TGPOejsKm40wr1p3C \
    --project cloud --environment production --since 24h --limit 1000 \
    --query ERROR --json \
    | jq -r 'select(.type == "log") | .data.message | fromjson? | select(.level == "ERROR") | .msg'
  ```

- **Policy violations:** a browser's report of a Content-Security-Policy
  violation is a `WARN` line `content security policy violation` from the
  `server` function, naming the page, the directive and what it blocked.
  First-party code reports nothing. The docs' and the website's policies
  allow the script and the frame of Vercel's toolbar, which Vercel builds
  into their bundles.
- **Cold starts:** a Go instance boots in one to two seconds.
- **Concurrency:** an instance serves several requests at once on its one
  vCPU, the Go service included, although Vercel's Fluid docs name only
  Node.js and Python. A burst fills the warm instances first and starts
  only a few new ones, not one per request: 40 parallel password checks
  on a preview with at most 16 warm instances started 3, and the warm
  instances' handler time rose from about 0.3 s to a median of 0.7 s.
  To tell the two apart, take a request's `request served` log time minus
  its `duration`, and compare it with the edge arrival in its Vercel
  request ID (`<id>-<unix ms>-<hash>`): a gap of a second or more is a cold
  start, a long handler time is sharing.
- **Connections:** four per instance through PlanetScale's PgBouncer, which
  pools per database and role: on `preview` every preview database is a
  pool of its own, so the cluster's `max_connections` bounds how many
  previews can be busy at the same time. Raise it (Parameters tab, needs a
  restart) before raising the pool size.
  - The four are shared by every request in flight on the instance: a
    fifth that needs the database waits in the pgx pool for one to free
    up, so a burst shows as handler time rather than errors.
  - A bigger pool multiplies across instances against the same
    `max_connections`, and handler time alone does not say whether
    connection waits or the shared vCPU stretched it.
- **Event retention:** a function runs only while it serves a request, so
  the server's own hourly purge is off here. A Vercel Cron Job (`crons` in
  `vercel.json`) calls `/cron/events-retention` on the production deployment
  at 17 minutes past every hour, with `CRON_SECRET` as its bearer token, and
  the server deletes the audit events older than 30 days
  ([ADR 049](../adrs/049-events-api-retention-export.md#amendment-2026-10-27-who-starts-the-purge-and-as-which-role)).
  - Each run logs one line, `event retention: purged events` with the number
    it deleted or `event retention: purge failed` with the cause; a failed
    run answers 500. Settings → Cron Jobs lists the job: View Logs shows its
    runs, and Run starts one now.
  - Previews get no cron job. Start a run on one by hand with the preview's
    `CRON_SECRET` from 1Password and the bypass secret
    ([Checking a deployment by hand](#checking-a-deployment-by-hand)):

    ```sh
    curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
      -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
      https://cloud-….vercel.app/cron/events-retention
    ```

  - A run that takes longer than 4½ minutes is cancelled and deletes
    nothing, and so does every run after it. Delete the backlog in batches,
    connected as the server's role, until a batch deletes no row:

    ```sql
    DELETE FROM zitadel_nextgen.events WHERE (project_id, id) IN (
      SELECT project_id, id FROM zitadel_nextgen.events
      WHERE created_at < now() - interval '30 days' LIMIT 50000);
    ```

- **Analytics:** the console reports page views and Web Vitals per route
  pattern (`/console/users/$userId`), the docs and the website per page,
  to the project's Analytics and Speed Insights tabs. Speed Insights samples
  by one variable per frontend, `CONSOLE_`, `DOCS_` and
  `WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE`, read at build time, so a new rate
  takes a redeploy; `0` turns it off. Web Analytics has no sampling and counts
  every page view.
- **Signing in:** `/console/` with the environment's root admin from
  1Password (production and preview have different passwords). Anyone else
  registers through the console's sign-in page.
- **Turbo's remote cache:** every service builds through turbo and reads and
  writes the team's remote cache, production and previews in separate
  entries: the console, the schemas and the packages the docs and the
  website render. The docs' and the website's own builds never come from it:
  their keys hold the deployment's ID. The launcher is never cached: it runs
  with the deployment's secrets, and any branch's build can write the cache. Each build's log shows `cache hit` or
  `cache miss` per task, and the deployment's Run Summary shows why a task
  missed. A build with a
  result that is wrong although its inputs are right (a broken or planted
  entry) is fixed by a team owner clearing the cache (team Settings → Build
  and Deployment → Remote Caching); a redeploy without the build cache
  skips the remote cache too.
- **Build cache:** Vercel keeps one per branch (a branch's first build
  starts from production's) and restores it before the installs: every
  `node_modules`, the docs' and the website's `.next/cache`, and
  `.vercel/cache/golang`, the Go toolchain with its module and build caches.
  Turbo's results are not in it: the turbo builds use the team's remote
  cache as Vercel sets it up, every build reading and writing it, production
  and previews in separate entries.
  Compressed, the build cache must stay under 1.5 GB, the limit of the
  project's Standard build machines. A bigger one is still created after the
  deployment, minutes of build machine time, then dropped ("Build cache size
  … exceeds limit"), and the next build installs every package and compiles
  the server from scratch. So the services install with
  `pnpm install --os=current --cpu=current` (their `installCommand` in
  `vercel.json`), which leaves out the other platforms' native packages that
  the workspace installs everywhere else (`supportedArchitectures` in
  `pnpm-workspace.yaml`). That took the cache from 1.52 GB to 0.86 GB, a
  little over half of it the Go caches. The services build one after another
  in one checkout. With `--optimistic-repeat-install`, pnpm skips an install
  when no manifest has changed since the last one, so the services after the
  first skip theirs. The first never trusts the restored `node_modules`
  blindly: a fresh checkout's manifests are newer than its last install, so
  pnpm compares the lockfile with the one that `node_modules` was installed
  from and installs when they differ. Go would keep each rebuild's compiled
  packages for five days, so `build-launcher.sh` drops those no build used
  in the last two hours. A new Go version starts the Go caches over: when the
  toolchain Vercel picks from `go.mod`'s `toolchain` line differs from the
  restored one, its Go builder downloads it and deletes
  `.vercel/cache/golang`, module cache included. The next build of each
  branch then downloads every module and compiles the server from nothing:
  the Go step took 74 s after
  [zitadel/nextgen#1845](https://github.com/zitadel/nextgen/pull/1845)
  instead of the usual 7–27 s. A new compiler could not reuse the old build
  cache anyway; the deletion costs only the module downloads, a few seconds.
  Each build log ends with the cache's size:
  `Uploading build cache [...]`.

## Later: read replicas in other regions

- PlanetScale Postgres adds read replicas in other regions of the same
  cloud provider, asynchronous, with a host of their own.
- The server has no read/write split yet; reads in another region need one
  before a replica helps.
- The server's region is its service's `functions` entry, keyed by its
  `entrypoint` path; the Go preset ignores a key that does not match it
  ([zitadel/nextgen#1871](https://github.com/zitadel/nextgen/pull/1871)).
  `TestVercelJSONKeepsTheServerInFrankfurt` holds the two together.
- Writes stay in Frankfurt. Nothing in this setup has to change to add a
  read path later.
