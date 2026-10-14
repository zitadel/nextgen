---
"@zitadel/sdk-tanstack-start": patch
---

The `/react` widgets now mount on the client only. On the server and during hydration they render
nothing, and right after hydration they mount with every prop in place. Before, the server sent a
bare `<zitadel-login>` tag that the browser upgraded with the widget's defaults before hydration,
so a register page started an extra sign-in flow, or briefly showed a missing-project error.

`/react` also exports `businessLocales` and the `ZitadelLoginProps`, `ZitadelLogoutProps` and
`ZitadelSessionProps` types, like `@zitadel/sdk-react`. `/client` now exports only
`configureZitadel`, `getApi` and `getZitadelConfig`, like the other meta-framework SDKs, so an
auto-import of `ZitadelLogin` can no longer pick the custom element class instead of the React
component.
