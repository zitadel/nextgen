# Agent Instructions — `packages/sdk-solid-start`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## This package re-exports the widgets of `@zitadel/sdk-solid`

- **Keep the re-export.** `src/components.ts` exports the widget components, their props
  types, the six event detail types, the three flow types, `businessLocales`
  and `configureZitadel` from `@zitadel/sdk-solid`, by name and never
  `export *`. It looks redundant because the same names exist in
  `sdk-solid`; it is deliberate, and removing it is a regression.
- **Why.** An app imports everything for solid-start from one package, a widget can
  move between packages without breaking an app, and this SDK's reference
  shows the same names as its siblings'. The full reasoning:
  [ADR 090](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk).
- **Keep it out of the server entries.** Widgets belong to the components
  entry only; `./server` and `./client` load on edge runtimes and must not
  pull the widget package.
- **`@zitadel/sdk-solid` is a runtime `dependency`, not a peer**, and this
  package's `build` and `dev` turbo tasks depend on its build.
- **Change the two together.** A widget name added to or removed from
  `sdk-solid` changes `src/components.ts` and `public-api.json` in the same change;
  `sdk-core`'s contract spec fails on a missing name.
- **Keep the `solid` export condition on `./components`.** Vite's Solid plugin finds the Solid
  libraries to leave out of pre-bundling by that condition. Without it the entry is pre-bundled
  as a plain dependency, Solid loads twice and the browser logs "You appear to have multiple
  instances of Solid" in a SolidStart dev server. `src/__tests__/components.test.ts` checks it.
