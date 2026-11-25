# Agent Instructions — `packages/sdk-next`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Widgets come from `@zitadel/sdk-react`

- Keep `src/components.ts` re-exporting the widgets, their types, `businessLocales` and
  `configureZitadel` of `@zitadel/sdk-react` by name; never `export *`, never drop it as redundant.
- The reasons are in [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk); read them before changing it.
- Keep widgets out of `./server` and `./client`: those entries load on edge runtimes.
- Keep `@zitadel/sdk-react` a runtime `dependency` (not a peer) that builds first.
- Change `src/components.ts` and `public-api.json` with any widget name change in `sdk-react`;
  `sdk-core`'s contract spec fails on a missing name.
