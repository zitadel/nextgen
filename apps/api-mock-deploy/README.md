# @zitadel/api-mock-deploy

A paper-thin Vercel wrapper that serves [`@zitadel/api-mock`](../../packages/api-mock)
as a live HTTP endpoint, so **every pull request gets its own throwaway
mock Zitadel API** at a unique preview URL — handy for pointing a demo
app, an SDK, or a manual test at a branch without running anything
locally.

## How it works

`packages/api-mock` exposes the mock as a plain Express app via
`createMockApp({ issuer })`. This app does nothing but adapt that app to
Vercel's serverless runtime:

- [`src/app.ts`](src/app.ts) builds the Express app, pinning the OIDC
  issuer for the current environment (`resolveIssuer`).
- [`api/index.ts`](api/index.ts) re-exports that app as the default
  export. `@vercel/node` treats an Express instance as a `(req, res)`
  handler and invokes it directly — no adapter.
- [`vercel.json`](vercel.json) disables framework detection
  (`framework: null`) and rewrites **every** path to the single function.
  Vercel preserves the original request URL across the rewrite, so the
  app sees `/sessions/exchange`, `/.well-known/jwks.json`, etc. exactly
  as it would locally.

The OIDC issuer is taken from `VERCEL_URL` (the immutable per-deploy
domain) so each preview advertises and verifies tokens against its own
URL. Locally it falls back to `http://localhost:8080`.

### `/.well-known/` is special

Vercel [reserves the `/.well-known/*` path](https://vercel.com/docs/routing/rewrites)
and will **not** route it through the catch-all rewrite, so the function
never sees `/.well-known/openid-configuration`. The only way to serve it
on a preview is a static file, so the `buildCommand` runs
[`scripts/generate-wellknown.ts`](scripts/generate-wellknown.ts), which
writes `public/.well-known/openid-configuration` using this deployment's
`VERCEL_URL`. That document points `jwks_uri` at `/auth/keys` — the same
JWKS the function serves, but on a path the rewrite *can* reach (unlike
`/.well-known/jwks.json`). Locally the Express app serves the discovery
document dynamically, so this only matters on Vercel.

### The function is pre-bundled

`@zitadel/api-mock` is consumed as raw TypeScript source (its `exports`
point at `./src/*.ts`), and a Vercel Node function is not guaranteed to
transpile a workspace TypeScript dependency at runtime — nor to resolve
pnpm's symlinked `node_modules` layout from the function's location. So
the `buildCommand` bundles the app with [`tsdown`](tsdown.config.ts)
(`noExternal`) into a single self-contained `dist/app.mjs`, and
[`api/index.ts`](api/index.ts) imports that bundle rather than the
workspace source. The bundle also inlines `@zitadel/api`'s compiled
output, so the deployed entry has nothing left to resolve at runtime but
Node built-ins. `src/app.ts` stays the source of truth — it is what
`scripts/local-server.ts` and the tests import directly.

## One-time Vercel setup

1. Create a new Vercel project and connect it to the `zitadel/nextgen`
   GitHub repo (install the Vercel GitHub app if it isn't already).
2. Set the project's **Root Directory** to `apps/api-mock-deploy`. The
   `installCommand`/`buildCommand` in `vercel.json` `cd` to the repo root
   so the pnpm workspace (and the `catalog:` protocol) resolve with the
   repo's pinned pnpm.
3. Leave the Framework Preset as **Other** (the `framework: null` in
   `vercel.json` enforces this).

Every push to a PR then publishes a preview deployment; the production
deployment tracks `main`.

## Caveat — state is in-memory and per-instance

The mock keeps sessions, consumed handoff tokens, and its signing keypair
**in process memory**, and the keypair is generated fresh on each cold
start. On serverless that state lives only inside a single warm lambda
instance. A session created in one request can therefore return `401` on
a later request that lands on a cold instance, and a token signed by one
instance won't verify on another.

For light, interactive per-PR testing this is usually fine — Vercel keeps
an instance warm and routes to it for a short window. It is **not** a
durable backend. Making it robust would mean moving sessions and the
keypair to an external store (e.g. Vercel KV), which is almost certainly
overkill for a mock.

## Local development

```sh
# from the repo root, inside devbox
devbox run -- corepack pnpm --filter @zitadel/api-mock-deploy dev    # node on :8080
devbox run -- corepack pnpm --filter @zitadel/api-mock-deploy test   # vitest
```

`dev` runs [`scripts/local-server.ts`](scripts/local-server.ts), which
serves the exact same Express app as the Vercel function — identical
apart from the transport.
