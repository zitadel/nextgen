# Agent Instructions — `packages/sdk-vue`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## Other SDKs re-export this package's widgets

`sdk-nuxt` re-export the widgets, props types, detail types, flow types,
`businessLocales` and `configureZitadel` of this package from their
`./components` entry, so an app imports everything for its framework from one
package ([why](../../docs/adrs/090-sdk-public-api-standard.md#widgets-come-through-the-framework-sdk)).

- **Do not remove or rename a widget export without changing those entries in
  the same change.** The contract spec in `sdk-core` fails on a missing name.
- **Keep every name this package exports a named export**, because the
  re-export lists names; `export *` is not allowed.
- **Do not make this package depend on those SDKs.** The dependency runs one
  way: the framework SDK depends on this package.
