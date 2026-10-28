# Agent Instructions — `packages/sdk-svelte`

`@zitadel/sdk-svelte` is Svelte 5 components wrapping the `<zitadel-*>` widgets.
The rules every SDK shares (exports as contract, peers, `libraryBuild()`,
warnings, edge tests) are in [packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Keep the `svelte` condition on `src/lib`**: a Svelte app compiles the
  components itself; `dist/index.js` is the compiled fallback.
- **Keep `src/lib` in `files`**, without the specs, or the `svelte` condition
  points at nothing.
- **Write the declarations with `svelteTypes()`** (`vite-plugin-svelte-types.ts`):
  it runs `svelte2tsx`, which types the `.svelte` components.
- **Ship the fallback minified with source maps**, through `libraryBuild()`.
