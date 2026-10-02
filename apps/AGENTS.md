# Agent Instructions — `apps/`

Shared conventions for the deployable apps. Read together with the
[root `AGENTS.md`](../AGENTS.md) and the app's own scoped `AGENTS.md`.

## Vercel build output

**Standalone Vercel sites build into `dist/` inside the app** (`apps/<app>/dist`),
and the app's `vercel.json` sets `"outputDirectory": "dist"`. Keep it `dist` — do
not introduce per-app output names (`storybook-static`, `build`, `out`, …). The
global `dist` rule in [`.gitignore`](../.gitignore) already covers it, so no
per-app ignore entry is needed.

Two apps are **exceptions**, for reasons that are not a style choice:

- **`console`** emits to `internal/staticui/console/dist` because the Go server
  `go:embed`s that exact tree to serve the console itself
  ([`internal/staticui/handler.go`](../internal/staticui/handler.go)). The output
  path is dictated by the embed, not by this convention.
- **`mock-zitadel`** is a Vercel **Function** deploy, not a static site: it
  bundles into `api/` and rewrites `/(.*) → /api`, so it has no static
  `outputDirectory` to standardise.
