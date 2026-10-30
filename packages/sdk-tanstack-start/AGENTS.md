# Agent Instructions — `packages/sdk-tanstack-start`

`@zitadel/sdk-tanstack-start` is the TanStack Start SDK: the request middleware,
the client helpers and React components. The rules every SDK shares (exports as
contract, peers, `libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Ship one declaration file per source file**: `unplugin-dts` emits them
  unbundled, so relative imports in `src/` carry `.js`.
- **Keep `"use client"` on `./react`**: it is an entry, so the build keeps
  the directive.
- **Ship it minified with source maps**, through `libraryBuild()`.
