# Agent Instructions — `packages/sdk-nuxt`

`@zitadel/sdk-nuxt` is the Nuxt module: the server proxy, the client plugin and
composables. The rules every SDK shares (exports as contract, peers,
`libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with `nuxtModule()`** (`@mridang/vite-plugin-nuxt-module`): it
  bundles `module` and `server` and copies `runtime/` file by file.
- **List each entry in `nuxtModule({ entry })` as well as in `exports`.**
- **Leave `runtime/` unbundled**: Nuxt compiles it inside the app, so it
  keeps its own files and is not minified.
- **Minify the bundled entries** with `minify` from `@zitadel/vite`, as the
  other SDKs are.
- **Ship it without source maps**: the plugin's `sourcemap` maps the
  declarations too, to `src/` files the package does not ship.
