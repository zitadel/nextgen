# Agent Instructions — `packages/sdk-nuxt`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Widgets come from `@zitadel/sdk-vue`

- Keep `src/components.ts` re-exporting the widgets, their types, `businessLocales` and
  `configureZitadel` of `@zitadel/sdk-vue` by name; never `export *`, never drop it as redundant.
- The reasons are in [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk); read them before changing it.
- Keep widgets out of `./server` and `./client`: those entries load on edge runtimes.
- Keep `@zitadel/sdk-vue` a runtime `dependency` (not a peer) that builds first.
- Change `src/components.ts` and `public-api.json` with any widget name change in `sdk-vue`;
  `sdk-core`'s contract spec fails on a missing name.

## The old `nextgen` names are refused

- Keep `legacyConfigProblems` (`src/module.ts`) throwing for the `nextgen` config key,
  `NUXT_NEXTGEN_*` and `NUXT_PUBLIC_NEXTGEN_*` variables, and
  `runtimeConfig.public.nextgenProxyPath` and `nextgenApiBase`.
- Nuxt ignores a key no module reads, so a kept `nextgen: { protectedRoutes }` would
  leave pages open; `src/__tests__/module.test.ts` pins each refusal.
- It sees only the build or dev environment, not a variable set on the running server.
