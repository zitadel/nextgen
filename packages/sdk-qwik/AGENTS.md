# Agent Instructions — `packages/sdk-qwik`

`@zitadel/sdk-qwik` is Qwik components wrapping the `<zitadel-*>` widgets. The
rules every SDK shares (exports as contract, peers, `libraryBuild()`, warnings,
edge tests) are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with `vite build --mode lib`**: `qwikVite()` then emits
  `index.qwik.mjs`, which the app's optimizer splits.
- **Keep it unminified** (`libraryBuild(…, { minify: false })`): Qwik's plugin
  builds libraries that way, and the optimizer needs the QRL closures as written.
- **Keep `generateBundle` stripped from `vite-plugin-qwik-post`**: it writes
  an app's `q-manifest.json` and warns on every external import.
- **Keep the test helpers out of the declarations**: `dts({ exclude })` lists
  the specs and `browser-commands.d.ts`.
