# Agent Instructions — `packages/sdk-qwik-router`

`@zitadel/sdk-qwik-router` is the Qwik Router SDK: the request middleware and
the client helpers. The rules every SDK shares (exports as contract, peers,
`libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Ship one declaration file per source file**: `unplugin-dts` emits them
  unbundled, so relative imports in `src/` carry `.js`.
- **Build with `libraryBuild()` and `unplugin-dts` only**: no Qwik plugin
  runs, since nothing here is a component.
- **Ship it minified with source maps**, through `libraryBuild()`.
