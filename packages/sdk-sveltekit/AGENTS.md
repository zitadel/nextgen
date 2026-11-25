# Agent Instructions — `packages/sdk-sveltekit`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Widgets come from `@zitadel/sdk-svelte`

- Keep `src/components.ts` re-exporting the widgets, their types, `businessLocales` and
  `configureZitadel` of `@zitadel/sdk-svelte` by name; never `export *`, never drop it as redundant.
- The reasons are in [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk); read them before changing it.
- Keep widgets out of `./server` and `./client`: those entries load on edge runtimes.
- Keep `@zitadel/sdk-svelte` a runtime `dependency` (not a peer) that builds first.
- Change `src/components.ts` and `public-api.json` with any widget name change in `sdk-svelte`;
  `sdk-core`'s contract spec fails on a missing name.
