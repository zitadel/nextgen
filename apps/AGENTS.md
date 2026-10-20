# Agent Instructions — `apps/`

Conventions shared by the deployable apps.

## Vercel build output

- A static site builds into `apps/<app>/dist`, which the global `dist` rule in
  [`.gitignore`](../.gitignore) covers. Never introduce another output name
  (`storybook-static`, `build`, `out`).
- The exceptions, each dictated by where something else reads the output:
  - `console` builds into `internal/staticui/console/dist`, the tree the Go
    server embeds ([`embed.go`](../internal/staticui/console/embed.go)). The
    cloud's `server` service compiles with `-tags noconsole`
    ([`cloud/build.sh`](cloud/build.sh)) so it does not embed it as well.
  - `docs` and `website` are Next.js: Vercel's Next.js preset reads `.next/`,
    so there is no output directory to set.
  - The cloud's `schemas` service (`root: apps/cloud` in the repo-root
    [`vercel.json`](../vercel.json)) renders the built-in schemas into the
    repo-root `dist/cloud-schemas`.
  - `mock-zitadel` is a Vercel Function with its own
    [`vercel.json`](mock-zitadel/vercel.json): tsdown bundles the app into
    `dist/app.mjs`, and the hand-written `api/index.mjs` re-exports it.

## What `next dev` writes

`docs`, `website` and `demo-next` run Next.js. Keep `git status` clean after a
dev server, `pnpm run cloud` or the demo's e2e lanes:

- Never commit `next-env.d.ts`: `next dev` and `next build`/`next typegen`
  point it at different route types. The docs' and website's `typecheck` run
  `next typegen` first.
- Keep `agentRules: false` in each app's `next.config`, or `next dev` writes
  Next's rules into the app's `AGENTS.md`. The installed Next.js may be newer
  than the one you remember: its guides are in the app's
  `node_modules/next/dist/docs/`.
