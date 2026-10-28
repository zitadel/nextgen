# Agent Instructions — `packages/sdk-core`

`@zitadel/sdk-core` is the framework-neutral core every SDK builds on: JWT
verification, the proxy middleware and the shared widget types. The rules every
SDK shares (exports as contract, peers, `libraryBuild()`, warnings, edge tests)
are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Ship `.mjs` and `.d.mts`**: the exports name them, so `unplugin-dts` emits
  ES-module declarations (`moduleFormat: "esm"`).
- **Keep the `@zitadel/source` condition on each subpath**: it points the
  workspace at `src/`; `libraryBuild()` fails if it names another file.
- **Ship it minified with source maps**, through `libraryBuild()`.
