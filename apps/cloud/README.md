# @zitadel/cloud

Deployment wrapper for the hosted **preview cloud**: the released
`ghcr.io/zitadel/nextgen:<version>` image, run as a Vercel container in
Frankfurt (`fra1`) against a PlanetScale Postgres database in AWS
`eu-central-1`. One region, one database, platform project local, the same
topology as self-hosted.

Operations live in [docs/runbooks/preview-cloud.md](../../docs/runbooks/preview-cloud.md).
The design and the platform research behind it are in
[docs/design/platform/preview-cloud-cloudflare-planetscale.md](../../docs/design/platform/preview-cloud-cloudflare-planetscale.md).

## What is in here

| File | Role |
|---|---|
| `Dockerfile.vercel` | `FROM ghcr.io/zitadel/nextgen:${NEXTGEN_VERSION}` plus the entrypoint. The version line is the only knob. |
| `entrypoint.sh` | Renders the master key into `nextgen.yaml` from `MASTER_KEY_PEM_B64`, binds to `$PORT`, execs `nextgen server --config …`. Never migrates. |
| `vercel.json` | Region `fra1`, a keep-warm cron on `/readyz`, Git deployments disabled so the workflow is the only deployer. |
| `scripts/admin-user.ts` | Mints the seeded platform admin: credential file plus the base64 bootstrap document for `BOOTSTRAP_ADMIN_USER_JSON_B64`. |
| `scripts/smoke.ts` | Post-deploy gate: readiness, project create, user create and query, CSRF probe. |
| `src/entrypoint.test.ts` | Runs `entrypoint.sh` against a stub binary and asserts the rendered config. |

## Why migrations run in CI, not in the container

`nextgen migrate` runs in `.github/workflows/cloud-deploy.yml` from
the same image tag **before** `vercel deploy --prod`. A server binary ahead of
its schema boots green and fails per request, and a rollout briefly runs old
and new binaries side by side, so every migration must be expand/contract and
must already be applied when the new image receives traffic.

## Local run

```sh
corepack pnpm --filter @zitadel/cloud run test
corepack pnpm --filter @zitadel/cloud run dev   # needs Docker and a .env.local, see the runbook
corepack pnpm --filter @zitadel/cloud run smoke -- http://localhost:3000
```
