# Agent Instructions — `packages/sdk-tanstack-start`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Widgets are built on `@zitadel/sdk-react`

- Keep `./components` the one widget entry: `src/components.tsx` wraps the React widgets in a
  client-only wrapper and re-exports their types and `businessLocales` by name.
- Never swap the wrappers for a plain re-export: TanStack Start renders on the server and hydrates.
- `configureZitadel` lives in `./client`; keep widgets out of `./server` and `./client`.
- Keep `@zitadel/sdk-react` a runtime `dependency` (not a peer) that builds first.
- The reasons are in [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk); read them before changing it.
