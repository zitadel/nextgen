# Agent Instructions — `apps/`

Shared conventions for the deployable apps. Read together with the
[root `AGENTS.md`](../AGENTS.md) and the app's own scoped `AGENTS.md`.

## Vercel build output

**Static Vercel sites build into `dist/` inside the app** (`apps/<app>/dist`).
The output is `dist` either because the app's build writes there (e.g.
`storybook`, whose `build` script passes `--output-dir dist`) or because its
framework preset already defaults there. Keep it `dist` — do not introduce
per-app output names (`storybook-static`, `build`, `out`, …). The hosted cloud's
`storybook` service (repo-root [`vercel.json`](../vercel.json)) serves `dist`
at `/storybook/`: a rewrite of the service maps that path onto the build. The
global `dist` rule in [`.gitignore`](../.gitignore) already covers it, so no
per-app ignore entry is needed.

Four apps are **exceptions**, for reasons that are not a style choice:

- **`console`** emits to `internal/staticui/console/dist` because the Go server
  `go:embed`s that exact tree to serve the console itself
  ([`internal/staticui/console/embed.go`](../internal/staticui/console/embed.go)).
  The output path is dictated by the embed, not by this convention. The
  hosted cloud's `console` service (repo-root [`vercel.json`](../vercel.json))
  builds it for `/console/` (`CONSOLE_BASE_PATH`) and serves that tree as its
  output directory, a rewrite of the service mapping `/console/` onto it.
  The cloud's `server` service builds in the same checkout, so its function
  is compiled with `-tags noconsole` ([`apps/cloud/build.sh`](cloud/build.sh))
  and does not embed that tree as well.
- **`docs`** and **`website`** are Next.js apps, deployed only as the hosted
  cloud's `docs` and `website` services: Next builds into `.next/`, which
  Vercel's Next.js preset reads, so there is no output directory to set.
- **`mock-zitadel`** is a Vercel **Function** deploy, not a static site: it
  bundles into `api/` and rewrites `/(.*) → /api`, so it has no static
  `outputDirectory` to standardise.

## What `next dev` writes

`docs`, `website` and `demo-next` run Next.js 16, whose `next dev` writes two
files into the app's folder. Neither is committed, so a dev server, `pnpm run
cloud` or the demo's e2e lanes leave `git status` as they found it.

- `next-env.d.ts` is ignored ([`.gitignore`](../.gitignore)), as Next's
  TypeScript guide says to. `next dev` points it at the route types in
  `.next/dev/types`, `next build` and `next typegen` at those in
  `.next/types`, so a committed copy changed whenever one ran after the other.
  Each of them writes it: the docs' and the website's `typecheck` start with
  `next typegen`, and an editor finds the file once one of them has run.
  demo-next's `typecheck` uses no route types and passes without it.
- `agentRules: false` in each app's `next.config` keeps `next dev` from
  writing Next's rules into the app's `AGENTS.md`, or creating one, whenever
  an AI coding agent runs it, and has the next run remove a block an earlier
  one left. Next adds the block back on every run until it is committed, and
  what these files tell an agent is the repo's to decide. Its point holds:
  Next 16 is not the Next.js an agent may remember, and the guides for the
  installed version are in the app's `node_modules/next/dist/docs/`.
