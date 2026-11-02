# Agent Instructions — `packages/sdk-vue`

`@zitadel/sdk-vue` is Vue components wrapping the `<zitadel-*>` widgets. The
rules every SDK shares (exports as contract, peers, `libraryBuild()`, warnings,
edge tests) are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with `unplugin-dts` only**: the components are render functions, so
  no Vue plugin compiles anything.
- **Ship it minified with source maps**, through `libraryBuild()`.
