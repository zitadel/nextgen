# apps/cloud

Deployment wrapper for the hosted **preview cloud**: the server of the
current `main` commit, compiled by Vercel from this repository and run as a
function on Vercel's Go runtime in Frankfurt (`fra1`) against a PlanetScale
Postgres database in AWS `eu-central-1`. One region, one database, platform
project local, the same topology as self-hosted. Main is production here;
version tags are for self-hosters.

The Vercel project is a [services](https://vercel.com/docs/services)
deployment defined in the repo-root `vercel.json`: `server` is the Go
binary compiled from the repo root by `vercel-build.sh` and started by
`launcher`, `console` and `login` are the two UIs built as static services
at `/console` and `/login`, `docs`, `storybook` and `website` are the other
apps, and the top-level rewrites give each its paths while everything else
reaches the server. All build separately and deploy together on every push:
a push to `main` is production, a pull request branch gets a preview with
its own database schema.

Operations live in [docs/runbooks/preview-cloud.md](../../docs/runbooks/preview-cloud.md).
The design and the platform research behind it are in
[docs/design/platform/preview-cloud-vercel-planetscale.md](../../docs/design/platform/preview-cloud-vercel-planetscale.md).

## What is in here

| File | Role |
|---|---|
| `vercel-build.sh` | The `buildCommand` of the `server` service: writes the stub UI embeds (the UIs are services), stamps version, commit and date into the binary, builds `launcher` to `$VERCEL_OUTPUT_FILE`, then runs `launcher migrate`. |
| `launcher/` | The function's entrypoint: renders the master key into `nextgen.yaml` from `MASTER_KEY_PEM_B64` and the admin document for `--user-file`, follows `$PORT`, resolves the deployment's schema, then runs the server command in process. Refuses `--migrate`. `launcher migrate` is the build-time mode that runs the migrations. `go test ./apps/cloud/launcher`, part of the server's test lane. |
| `scripts/smoke.mts` | Smoke test against a deployment: readiness, project create, user create and query, session probe, console and login pages, docs page, API reference and `llms.txt`, storybook, website start page. By hand: `corepack pnpm exec tsx apps/cloud/scripts/smoke.mts <url>`. |
| `../../vercel.json` | The six services, the public route table (redirects for bare UI prefixes, rewrites per service, server catch-all), region `fra1`, Git deployments on. |
| `../../.vercelignore` | Keeps repo meta and build artifacts out of CLI uploads (a Git deployment clones the repository and does not read it); Go sources and every moon project source stay in. |

## Why migrations run in the build, not at startup

`vercel-build.sh` compiles the launcher and then runs `launcher migrate`,
which resolves the deployment's database URL (production as configured and
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

`sh apps/cloud/vercel-build.sh` builds and migrates the way Vercel does;
set `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_PULL_REQUEST_ID`
to simulate a deployment.
