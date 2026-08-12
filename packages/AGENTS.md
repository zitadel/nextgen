# Agent Instructions — `packages/`

Scoped instructions for packages that have **no nearer `AGENTS.md` of their
own** — today that is the nine `packages/sdk-*` packages plus `packages/api`
and `packages/config`. Packages with their own scoped file
(`components`, `design-tokens`, `shared-component-styles`, `testing`,
`api-mock`) are governed by those files, not this one. Defer to root
[`AGENTS.md`](../AGENTS.md) for repo-wide rules.

## `packages/sdk-*` (applies only to the SDK packages)

Nine published SDKs: `sdk-core` plus one per framework (next, nuxt, react,
vue, angular, solid, svelte, qwik). All are public npm packages in
`PUBLIC_RELEASE_PACKAGES` and the changesets `fixed` group — every observable
change needs a changeset, and the whole train versions together.

- **`sdk-core` is the shared contract**: JWT verification (`verifyJwt`),
  middleware primitives, runtime resolution, and the `NextgenSession` /
  `AuthResult` types every SPA SDK re-exports via `@zitadel/sdk-core/types`.
  Change a shared type there, not by forking it into a framework package.
- **Export stability**: the `exports` map and public entry points
  (`/server`, `/client`, `/react`, `/module`, `/types`, …) are consumer
  contract — removing or renaming one is a breaking change; additions need a
  changeset. Do not deep-import between SDK packages; go through the
  published entry points.
- **Peer dependencies**: framework runtimes (`react`, `vue`, `@angular/core`,
  `solid-js`, `svelte`, `@builder.io/qwik`, `next`, `nuxt`) are
  `peerDependencies`, never hard dependencies — an SDK must not pin its
  host framework.
- **TypeScript floor**: consumers need TypeScript ≥ 5.0 (the entry points use
  `export type *`). This is a compatibility floor, stated here once — READMEs
  link it rather than restating.
- **Build tooling is deliberately mixed**: `sdk-core`/`sdk-next` build with
  per-file `tsc` because bundlers merge `"use client"` modules into shared
  chunks and strip the directive (the RSC chunk trap); the SPA SDKs bundle
  with Vite. Don't "unify" the build without re-testing the App Router
  client/server split.
- **The same-origin proxy is the shared concept**: every SDK fronts the API
  through `/__nextgen/*` on the app's own origin
  ([ADR 036](../docs/adrs/036-api-credential-planes.md), ADR 005). Middleware
  SDKs (next, nuxt) implement it server-side; SPA SDKs document a dev/deploy
  proxy. Production SPA deployment guidance is tracked in
  [issue #560](https://github.com/zitadel/nextgen/issues/560) — READMEs link
  this section instead of restating the caveat twelve times.

## `packages/api`

Generated TypeScript API client (orval output under `src/generated/` —
regenerate, don't hand-edit; the OpenAPI source of truth is
[`api/openapi/`](../api/openapi/AGENTS.md)). Runtime helpers
(`configureZitadel()` from `@zitadel/api/config`, proxy-path handling) are
hand-written and the primary consumer surface.

## `packages/config`

Versioned local config schemas and defaults. The defaults are product:
`defaults/README-*.md` ship to npm **and** are copied into customer projects
as `.zitadel/{schemas,flows,branding}/README.md` (`src/readmes.ts`) — treat
edits there as customer-facing (changeset + `fix:`/`feat:`, not `docs:`).
`defaults/default-login.json` is the authority for flow step shape
([`packages/api-mock/AGENTS.md`](api-mock/AGENTS.md) owns the
fixture-diff rule).
