# Agent Instructions — `packages/sdk-qwik-router`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## This package re-exports the widgets of `@zitadel/sdk-qwik`

- **Keep the re-export.** `src/components.ts` exports the widget components, their props
  types, the six event detail types, the three flow types, `businessLocales`
  and `configureZitadel` from `@zitadel/sdk-qwik`, by name and never
  `export *`. It looks redundant because the same names exist in
  `sdk-qwik`; it is deliberate, and removing it is a regression.
- **Why.** An app imports everything for qwik-router from one package, a widget can
  move between packages without breaking an app, and this SDK's reference
  shows the same names as its siblings'. The full reasoning:
  [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk).
- **Keep it out of the server entries.** Widgets belong to the components
  entry only; `./server` and `./client` load on edge runtimes and must not
  pull the widget package.
- **`@zitadel/sdk-qwik` is a runtime `dependency`, not a peer**, and this
  package's `build` and `dev` turbo tasks depend on its build.
- **Change the two together.** A widget name added to or removed from
  `sdk-qwik` changes `src/components.ts` and `public-api.json` in the same change;
  `sdk-core`'s contract spec fails on a missing name.
