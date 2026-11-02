# Agent Instructions — `packages/sdk-react`

`@zitadel/sdk-react` is React components wrapping the `<zitadel-*>` widgets. The
rules every SDK shares (exports as contract, peers, `libraryBuild()`, warnings,
edge tests) are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with `@vitejs/plugin-react` and `unplugin-dts`**: one bundled
  `dist/index.js` and its declarations.
- **Ship it minified with source maps**, through `libraryBuild()`.
