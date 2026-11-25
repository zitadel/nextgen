# Agent Instructions — `packages/sdk-qwik`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## The meta SDK re-exports this package's widgets

- `sdk-qwik-router` re-exports the widgets, types, `businessLocales` and `configureZitadel` of this
  package by name from `./components`, so one package is enough for an app.
- Keep each of those a named export here, and change the re-exporting entry in the same change
  as any rename or removal; `sdk-core`'s contract spec fails on a missing name.
- Never depend on that SDK from here: the dependency runs one way. See [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk).
