# @zitadel/cloud

Deployment wrapper for the hosted **preview cloud**: the server image of
the current `main` commit (`ghcr.io/zitadel/nextgen:sha-<commit>`), run as a
Vercel container in Frankfurt (`fra1`) against a PlanetScale Postgres
database in AWS `eu-central-1`. One region, one database, platform project
local, the same topology as self-hosted. Main is production here; version
tags are for self-hosters.

The Vercel project is a [services](https://vercel.com/docs/services)
deployment defined in the repo-root `vercel.json`: the `server` service is
this directory's container, the `docs` service is `apps/docs`, the `website`
service is `apps/website`, and the top-level rewrites give the website `/`
and the docs their prefixes (`/docs`, `/reference`, `/assets`, …) while
everything else reaches the server. All build separately, deploy together.

Operations live in [docs/runbooks/preview-cloud.md](../../docs/runbooks/preview-cloud.md).
The design and the platform research behind it are in
[docs/design/platform/preview-cloud-cloudflare-planetscale.md](../../docs/design/platform/preview-cloud-cloudflare-planetscale.md).

## What is in here

| File | Role |
|---|---|
| `Dockerfile.vercel` | `FROM ghcr.io/zitadel/nextgen:${NEXTGEN_VERSION}` plus the entrypoint. The committed default is `main`; the deploy workflow pins the commit's `sha-…` tag for each build. |
| `entrypoint.sh` | Renders the master key into `nextgen.yaml` from `MASTER_KEY_PEM_B64`, binds to `$PORT`, execs `nextgen server --config …`. Refuses `--migrate`. |
| `../../vercel.json` | Services (`server` = this directory, `docs` = `apps/docs`, `storybook` = `apps/storybook`, `website` = `apps/website`), the public route table, region `fra1`, a keep-warm cron on `/readyz`, Git deployments disabled so the workflow is the only deployer. |
| `../../.vercelignore` | Keeps Go sources and build artifacts out of CLI uploads; the repo root is the deployment root. |
| `scripts/admin-user.ts` | Mints the seeded platform admin: credential file plus the base64 bootstrap document for `BOOTSTRAP_ADMIN_USER_JSON_B64`. |
| `scripts/smoke.ts` | Post-deploy gate: readiness, project create, user create and query, session probe, docs page and static file, website start page. |
| `src/entrypoint.test.ts` | Runs `entrypoint.sh` against a stub binary and asserts the rendered config. |

## Why migrations run in CI, not in the container

`nextgen migrate` runs in `.github/workflows/cloud-deploy.yml` from the
same `sha-<commit>` image **before** `vercel deploy --prod`. A server binary
ahead of its schema boots green and fails per request, and a rollout briefly
runs old and new binaries side by side, so every migration must be
expand/contract and must already be applied when the new image receives
traffic. The entrypoint refuses `--migrate`, and preview deployments carry
no production database URL or master key, so nothing but that workflow step
can touch the production schema.

## Local run

```sh
corepack pnpm --filter @zitadel/cloud run test
corepack pnpm --filter @zitadel/cloud run dev   # needs Docker and a .env.local, see the runbook
corepack pnpm --filter @zitadel/cloud run smoke -- http://localhost:3000
```

`dev` and `deploy` run the Vercel CLI with `--cwd ../..` because the
deployment root is the repository root.
