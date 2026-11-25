# Agent Instructions — `packages/sdk-solid`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Other SDKs re-export this package's widgets

- `sdk-solid-start` re-export the widgets, types, `businessLocales` and
  `configureZitadel` of this package by name from `./components`.
- Keep each of those a named export here, and change the re-exporting entries in the same change
  as any rename or removal; `sdk-core`'s contract spec fails on a missing name.
- Never depend on those SDKs from here: the dependency runs one way. See [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk).
