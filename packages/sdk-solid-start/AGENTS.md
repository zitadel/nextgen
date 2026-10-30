# Agent Instructions — `packages/sdk-solid-start`

`@zitadel/sdk-solid-start` is the SolidStart SDK: the request middleware and the
client helpers. The rules every SDK shares (exports as contract, peers,
`libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Ship one declaration file per source file**: `unplugin-dts` emits them
  unbundled, so relative imports in `src/` carry `.js`.
- **Ship it minified with source maps**, through `libraryBuild()`.
