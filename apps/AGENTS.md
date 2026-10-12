# Agent Instructions — `apps/`

Shared conventions for the deployable apps. Read together with the
[root `AGENTS.md`](../AGENTS.md) and the app's own scoped `AGENTS.md`.

## Vercel build output

**Static Vercel sites build into `dist/` inside the app** (`apps/<app>/dist`).
The output is `dist` either because the app's build writes there (e.g.
`storybook`, whose `build` script passes `--output-dir dist`) or because its
framework preset already defaults there (e.g. `docs`, whose
[`vercel.json`](docs/vercel.json) uses `"framework": "vite"` and so needs no
explicit key). Keep it `dist` — do not introduce per-app output names
(`storybook-static`, `build`, `out`, …). The hosted cloud's `storybook` service
(repo-root [`vercel.json`](../vercel.json)) moves the build to
`dist/storybook/`, the path it serves it at, and still serves `dist`. The global
`dist` rule in [`.gitignore`](../.gitignore) already covers it, so no per-app
ignore entry is needed.

Two apps are **exceptions**, for reasons that are not a style choice:

- **`console`** emits to `internal/staticui/console/dist` because the Go server
  `go:embed`s that exact tree to serve the console itself
  ([`internal/staticui/console/embed.go`](../internal/staticui/console/embed.go)).
  The output path is dictated by the embed, not by this convention. The
  hosted cloud's `console` service (repo-root [`vercel.json`](../vercel.json))
  copies that build to `dist/ui/console/` and serves `dist`.
- **`mock-zitadel`** is a Vercel **Function** deploy, not a static site: it
  bundles into `api/` and rewrites `/(.*) → /api`, so it has no static
  `outputDirectory` to standardise.
