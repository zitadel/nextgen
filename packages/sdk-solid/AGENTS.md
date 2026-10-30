# Agent Instructions — `packages/sdk-solid`

`@zitadel/sdk-solid` is Solid components wrapping the `<zitadel-*>` widgets. The
rules every SDK shares (exports as contract, peers, `libraryBuild()`, warnings,
edge tests) are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with `vite-plugin-solid` and `unplugin-dts`**: the JSX ships
  compiled to Solid's DOM output.
- **Ship it minified with source maps**, through `libraryBuild()`.
