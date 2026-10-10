# apps/cloud

Deployment wrapper for the hosted **preview cloud**: the server of the
current `main` commit, compiled by Vercel from this repository and run as
Vercel functions against PlanetScale Postgres. Three servers from one
binary: the **identity home** in Frankfurt (`fra1`, its own schema: the
accounts of the cloud, nothing of any project) at the root of the host, and
one **region** per database, `/eu` (fra1, AWS `eu-central-1`) and `/us`
(`cle1`, AWS `us-east-2`), each a plain nextgen with its own platform
project that accepts the home's session (`platform.home.url`). Main is
production here; version tags are for self-hosters.

The Vercel project is a [services](https://vercel.com/docs/services)
deployment defined in the repo-root `vercel.json`: `home`, `server_eu` and
`server_us` are the three servers, each a service whose build command
(`build-output.sh`) compiles `launcher` and emits the function itself,
pinned to its region; `cloud` is the control plane (`api/`, under `/cloud`,
built the same way); `migrate` is an internal Go-preset service whose build
step runs the migrations of every database; `console` is the console at
`/console`; `docs`, `storybook` and `website` are the other apps; and the
top-level rewrites
give each its paths while everything else reaches the home. All build
separately and deploy together on every push: a push to `main` is
production, a pull request branch gets a preview with its own database
schema in every database.

Operations live in [docs/runbooks/preview-cloud.md](../../docs/runbooks/preview-cloud.md).
The design and the platform research behind it are in
[docs/design/platform/preview-cloud-vercel-planetscale.md](../../docs/design/platform/preview-cloud-vercel-planetscale.md).

## What is in here

| File | Role |
|---|---|
| `build-output.sh` | The build command of the three server services: compiles the launcher for the function's platform (downloads Go when the build image has none), takes the proxy Vercel's Go preset runs in front of a server from the `@vercel/go` package, and writes the Build Output itself: the function with `regions` (the preset drops a service's `functions.regions`) and the service's role in its environment (`CLOUD_ROLE`, `CLOUD_PATH_PREFIX`), plus the route that strips a region's path prefix in front of the catch-all. The services are declared `framework: vite` so that Vercel's static-build pipeline runs the command and takes the emitted tree; a service with no framework is refused ("multiple frameworks detected"). |
| `build.sh` | Compiles the launcher with the `noui` tag (the UIs are services, nothing is embedded; the launcher runs the server in the external UI mode, which serves the runtime document only), stamps version, commit (`VERCEL_GIT_COMMIT_SHA`) and date into the binary. Used by the `server` service's `buildCommand` (`OUT="$VERCEL_OUTPUT_FILE" sh apps/cloud/build.sh`, Vercel's Go preset runs the binary it writes) and by `vercel-build.sh`. |
| `vercel-build.sh` | The `buildCommand` of the internal `migrate` service (Go runtime, no rewrite): `build.sh`, then `launcher migrate`. The function it produces is never invoked; the service exists so the migrations run in a build step of their own and fail the deployment, never the serving function. |
| `api/` | The cloud's control plane, a Go service next to the home under `/cloud` with its own schema `cloud` in the home's database: the region directory (`GET /cloud/regions`), the signed-in person's projects with their regions (`GET /cloud/me/projects`), and creating a project in a region (`POST /cloud/projects {name, region}`: the region's public create, the claim challenge with the one-time secret, the completion with the person's session, recorded as a placement). Authenticates by asking the home for the session cookie, as a region does. Migrates its schema at startup under an advisory lock. `go test ./apps/cloud/api`. |
| `launcher/` | The function's entrypoint: renders the master key into `nextgen.yaml` from `MASTER_KEY_PEM_B64` and the admin document for `--user-file`, follows `$PORT`, resolves the deployment's schema and the database of its region (`CLOUD_DATABASE_URL_<REGION>`), derives the public base and the home URL from the service's role (`CLOUD_ROLE`, `CLOUD_PATH_PREFIX`, the host), runs a region headless and the home in the external UI mode, then runs the server command in process. Refuses `--migrate`. `launcher migrate` is the build-time mode that runs the migrations. `go test ./apps/cloud/launcher`, part of the server's test lane. |
| `scripts/smoke.mts` | Smoke test against a deployment: readiness, project create, user create and query, session probe, console and login pages, docs page, API reference and `llms.txt`, storybook, website start page. By hand: `corepack pnpm exec tsx apps/cloud/scripts/smoke.mts <url>`. |
| `../../vercel.json` | The nine services, the public route table (redirects for bare UI prefixes, rewrites per service, the regions under `/eu` and `/us`, the home as catch-all), region `fra1` for functions that name none, Git deployments on. |
| `../../.vercelignore` | Keeps repo meta and build artifacts out of CLI uploads (a Git deployment clones the repository and does not read it); Go sources and every moon project source stay in. |

## Why migrations run in the build, not at startup

The `migrate` service's build step (`vercel-build.sh`) compiles the launcher
and runs `launcher migrate`, which resolves the deployment's database URL (production as configured and
only from `main`; a preview in the schema `pr_<number>` of the preview
database) and runs `nextgen migrate` **before** the deployment goes live. A
server binary ahead of its schema boots green and fails per request, and a
rollout briefly runs old and new binaries side by side, so every migration
must be expand/contract and must already be applied when the new deployment
receives traffic. A failed migration fails the build and the previous
deployment keeps serving. The serving invocation refuses `--migrate`, so
nothing but that build step can touch a schema. Self-hosters are not
affected: `nextgen server --migrate` and `nextgen migrate` keep working as
documented.

## Local run

The launcher is a normal Go program:

```sh
go test ./apps/cloud/launcher
MASTER_KEY_PEM_B64="$(base64 < master-key.pem | tr -d '\n')" \
NEXTGEN_DATABASE_POSTGRES='postgres://…' \
  go run ./apps/cloud/launcher
```

`sh apps/cloud/vercel-build.sh` builds and migrates the way the `migrate`
service does; set `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` and
`VERCEL_GIT_PULL_REQUEST_ID` to simulate a deployment. `OUT=bin/nextgen-launcher sh apps/cloud/build.sh` compiles the binary;
`CLOUD_OUTPUT_DIR=/tmp/out CLOUD_SERVICE=server_eu sh apps/cloud/build-output.sh`
emits a region's function the way its service does, and `vercel build`
runs every service locally. A deployment from this machine is
`vercel deploy` with the database URLs as `-e` and `--build-env` (the
regional ones name their schema, since a CLI upload from a worktree carries
no git metadata to derive one from) and `CLOUD_HOST` for the public bases.
