# Agent Instructions — `packages/sdk-next`

`@zitadel/sdk-next` is the Next.js SDK: middleware, the server and client
helpers, and React components for the App Router. The rules every SDK shares
(exports as contract, peers, `libraryBuild()`, warnings, edge tests) are in
[packages/AGENTS.md](../AGENTS.md).

## Packaging

- **Keep `preserveModules`**: Next compiles each `"use client"` module on
  its own, and a bundled chunk would lose the directive.
- **Keep `import "server-only"`** in the server modules; the build keeps it.
- **Ship it minified with source maps**, through `libraryBuild()`; the
  directive stays the first statement.
- **Read minified output in the edge `clientReferences()` helper**: it finds
  the trailing `export{…}` anywhere, not at a line start.
- **Keep `./jsx` types-only**: it augments the JSX namespace, so it is
  imported for its side effect.
