# Agent Instructions — `packages/sdk-react`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## The meta SDKs re-export this package's widgets

- `sdk-next` and `sdk-tanstack-start` re-export the widgets, types and `businessLocales` of this
  package by name from `./components`, so one package is enough for an app.
- `sdk-next` also re-exports `configureZitadel` from `./components`; `sdk-tanstack-start`
  exports it from `./client`.
- Keep each of those a named export here, and change the re-exporting entries in the same change
  as any rename or removal; `sdk-core`'s contract spec fails on a missing name.
- Never depend on those SDKs from here: the dependency runs one way. See [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk).
