# Agent Instructions — `packages/sdk-angular`

`@zitadel/sdk-angular` is Angular standalone components wrapping the
`<zitadel-*>` widgets. The rules every SDK shares (exports as contract, peers,
`libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Build with Analog's plugin**: it runs Angular's compiler and writes the
  partial-Ivy JavaScript and its `.d.ts`; no `ngc` or `unplugin-dts` step runs.
- **Keep it unminified** (`libraryBuild(…, { minify: false })`): an app's
  linker rejects minified `ɵɵngDeclare*` metadata (`!0`, template strings).
- **Trust the edge spec on that**: it links the built `dist/public-api.js`,
  as an app does, and fails on minified output.
- **Check templates in `typecheck`**: Analog skips them, so `ngc --noEmit`
  enforces `strictTemplates`.
- **Ship the entry as `dist/public-api.js`** and its types as
  `dist/public-api.d.ts`; moving them breaks deep imports.
