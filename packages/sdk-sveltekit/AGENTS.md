# Agent Instructions — `packages/sdk-sveltekit`

`@zitadel/sdk-sveltekit` is the SvelteKit SDK: the `handle` hook that proxies
`/__nextgen` and the client helpers. The rules every SDK shares (exports as
contract, peers, `libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Ship one declaration file per source file**: `unplugin-dts` emits them
  unbundled, so relative imports in `src/` carry `.js`.
- **Import only types from `@sveltejs/kit`**: it is a peer, and the app's
  hook reads `$app/env/private`, never this package.
- **Ship it minified with source maps**, through `libraryBuild()`.
