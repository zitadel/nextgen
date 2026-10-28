# Agent Instructions — `packages/`

Rules for the packages without an `AGENTS.md` of their own: the SDKs
(`packages/sdk-*`), `packages/api` and `packages/config`.

## The SDKs (`packages/sdk-*`)

`sdk-core` plus one package per framework. Every one is public, listed in
`PUBLIC_RELEASE_PACKAGES` and in the changesets `fixed` group: every observable
change needs a changeset, and the whole train versions together.

- **`sdk-core` is the shared contract**: JWT verification (`verifyJwt`),
  middleware primitives, runtime resolution, and the `NextgenSession` /
  `AuthResult` types the SDKs re-export through `@zitadel/sdk-core/types`.
  Change a shared type there; never fork it into a framework package.
- **Exports are consumer contract**: removing or renaming an `exports` entry
  (`/server`, `/client`, `/types`, …) is a breaking change, and an addition
  needs a changeset. Never deep-import between SDKs; use their published
  entry points.
- **Framework runtimes are `peerDependencies`**, never `dependencies`: an SDK
  never pins its host framework. `src/contract.spec.ts` in `sdk-core` checks
  each README lists its peers.
- **TypeScript floor**: consumers need TypeScript ≥ 5.0, because the entry
  points use `export type *`. This is the one statement of it; READMEs link
  here.
- **Build an SDK with plain Vite**: `libraryBuild()` from `@zitadel/vite`, the
  framework plugin and `unplugin-dts` (`svelteTypes()` for Svelte; Analog
  writes Angular's).
- **Add an entry point to `exports` and give it a source, never to a config**:
  `libraryBuild()` derives the entries from `exports`.
- **Fix a Rolldown warning, or allow its code with a comment saying why**:
  `libraryBuild()` fails the build on any other.
- **Keep `sdk-next` on `preserveModules`**: bundlers merge `"use client"` modules
  into shared chunks and strip the directive. Re-test the App Router split.
- **Ship SDKs minified with source maps**: `libraryBuild()` does both; a build
  outside it reuses `minify` from `@zitadel/vite`.
- **Build `sdk-nuxt` with `nuxtModule()`** (`@mridang/vite-plugin-nuxt-module`):
  list each entry in `nuxtModule({ entry })` as well as in `exports`.
- **Ship `sdk-nuxt` without source maps**: the plugin's `sourcemap` maps the
  declarations too, to `src/` files the package does not ship.
- **Keep `sdk-angular` unminified**: an app's Angular linker rejects minified
  `ɵɵngDeclare*` metadata; its edge spec links the built package and fails.
- **Keep `sdk-qwik` unminified**: Qwik's plugin builds libraries unminified,
  and the app's optimizer splits the QRLs in `.qwik.mjs`.
- **Check `sdk-angular` templates in `typecheck`**: Analog's plugin skips them,
  so `ngc --noEmit` enforces `strictTemplates`.
- **The same-origin proxy is the shared concept**: every SDK fronts the API
  through `/__nextgen/*` on the app's own origin
  ([ADR 036](../docs/adrs/036-api-credential-planes.md), ADR 005). Server SDKs
  implement it; SPA SDKs document a dev/deploy proxy (production guidance:
  [#560](https://github.com/zitadel/nextgen/issues/560)).
- **Edge entries are tested in the edge runtime**: an SDK entry that claims
  edge support has an `edge` project (`edgeProject()` in `@zitadel/vitest-config`,
  Vercel's `edge-runtime` VM) that runs only its edge specs. It fails at
  config load if none exists. Every edge project resolves with `workerd`, the
  condition Wrangler adds for Cloudflare Workers. A package adds a condition
  only where what it loads needs one: `react-server` and `edge-light` for
  Next, whose bundler adds both, and `worker` for Solid, which ships its server
  build under that name. Each carries a one-line comment saying why. Add an
  edge project only where the README claims edge, and leave Node-only entries
  out.
  An edge spec is named after its entry, `<entry>.edge.<spec|test>.<ext>`,
  sits where the package keeps the spec of that entry, uses the suffix of the
  package's own tests, and imports the built package by its name, as a
  consumer's bundler resolves it, never the source. It needs the package's
  `build` before it typechecks or runs.
  The contract spec in `sdk-core` holds the specs to one shape: the client
  SDKs' `edge-entry` and `edge-render` blocks and the server SDKs'
  `edge-server` block must carry the same titles and, byte for byte, the same
  body, and every edge project declaration must read the same. Only the
  glue above a block, which hands a request or a render to the framework, is
  the framework's own.
- **One Agent Skill per framework SDK**, at `<pkg>/skills/<name>/SKILL.md`,
  plus `skills/zitadel-components/SKILL.md` for `@zitadel/components`; the
  top-level `skills/zitadel` routes to them. A new framework SDK adds its
  skill with the same sections and structure as the others.
- **Skills are discover-first**: they teach the integration pattern and send
  the reader to the package's README and types for props, exports and APIs,
  never listing them. A changed property updates the README or types; edit a
  skill only when the pattern changes.

## `packages/api`

The generated TypeScript client: orval output under `src/generated/`.
Regenerate it, never hand-edit it; the source is
[`api/openapi/`](../api/openapi/AGENTS.md). The runtime helpers in
`src/runtime/` (`configureZitadel()` from `@zitadel/api/config`, proxy-path
handling) are hand-written and the primary consumer surface.

## `packages/config`

Versioned local config schemas and defaults. The defaults are product:
`defaults/README-*.md` ship to npm and are copied into customer projects as
`.zitadel/{schemas,flows,branding}/README.md` (`src/readmes.ts`), so an edit
there is customer-facing (changeset, `fix:`/`feat:`, not `docs:`).
`defaults/default-login.json` is the authority for flow step shape; the
fixture-diff rule is in [`packages/api-mock/AGENTS.md`](api-mock/AGENTS.md).
