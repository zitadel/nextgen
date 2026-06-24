# @zitadel/preview-registry

A per-PR snapshot npm registry deployed to Vercel. On every push, the
Vercel build packs each non-private package under `packages/`, stamps
the version to `0.0.0-sha-<commit>`, rewrites `workspace:*` deps to that
snapshot version, and bundles the tarballs into the serverless function
— no external storage and no GitHub secrets.

The Hono app serves the npm registry protocol (packument, tarball,
scoped + URL-encoded variants, audit stubs, robots, favicon) plus a
small landing page at `/`. Each Vercel preview deploy is its own
isolated registry scoped to that branch's commit.

## Install from a deploy

No version needed — the registry resolves `latest` to the deploy's
snapshot:

```sh
npm install @zitadel/sdk-react --registry=https://<preview-deploy>.vercel.app
```

Or pin the scope in `.npmrc` and install normally:

```sh
# .npmrc
@zitadel:registry=https://<preview-deploy>.vercel.app
```

Pin an exact build for reproducibility:

```sh
npm install @zitadel/sdk-react@0.0.0-sha-<sha> --registry=https://<preview-deploy>.vercel.app
```

## Local development

The same Hono app runs on Node without Vercel auth:

```sh
corepack pnpm --filter @zitadel/preview-registry stage:local  # pack workspace packages into .snapshots/
corepack pnpm --filter @zitadel/preview-registry dev           # serve at http://localhost:3000
```

## Deployment

Create a Vercel project with **Root Directory** set to
`apps/preview-registry` and **Deployment Protection** disabled (the npm
CLI cannot pass Vercel SSO). Everything else is driven by `vercel.json`.

## Scripts

- `dev` — run the local Node server against `.snapshots/`
- `stage:local` — pack workspace packages into `.snapshots/`
- `test` — Vitest unit tests
- `typecheck` — `tsc --noEmit`
- `lint` — ESLint
