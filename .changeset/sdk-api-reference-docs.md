---
"@zitadel/sdk-core": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-qwik-router": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-vue": minor
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/components": minor
---

Every SDK now has a warning-free API reference that documents each export, prop, event and option, and exports the same names for the same things. Each framework SDK also exports the widgets of its UI SDK from a `./components` entry, so an app imports everything for its framework from one package. The Angular components use signal inputs and outputs.

**Breaking:** the names that carried the alpha codename now say Zitadel: `createNextgenHandle`, `createNextgenOnRequest`, `createNextgenRequestMiddleware`, `createNextgenMiddleware` and `nextgenMiddleware` are `createZitadelHandle`, `createZitadelOnRequest`, `createZitadelRequestMiddleware`, `createZitadelMiddleware` and `zitadelMiddleware`; `NextgenSession` is `ZitadelAuthSession`; `NextgenMiddlewareOptions` is `ZitadelMiddlewareOptions`; the internal header is `x-zitadel-auth-token`; the Qwik Router route file is `plugin@zitadel.ts`; and the Nuxt module key and variables are `zitadel` and `NUXT_ZITADEL_*`, so a Nuxt app that keeps `nextgen` or `NUXT_NEXTGEN_*` now fails to build instead of losing its `protectedRoutes`. The `/__nextgen` proxy path is unchanged. Also: `@zitadel/sdk-tanstack-start/react` is `@zitadel/sdk-tanstack-start/components`; the Angular classes lose their `Component` suffix and need Angular 19 or newer (`zitadel setup` now refuses Angular 17 and 18); their inputs are read-only signals (`input()`), so code that assigned an input directly (`component.project = value`) must bind it in a template or call `setInput`, and code that read it as a plain value reads `component.project()`; `ZitadelLoginProps` and its siblings are one type per widget, and in Angular they are the inputs only; the flow types come from `@zitadel/sdk-core` (`ZitadelFlowPurpose`, `ZitadelFlowStep`, `ZitadelFlowBehavior`) instead of the generated client; and the helper types `WidgetName`, `WidgetTag`, `StandardAttributeName`, `StandardAttributes`, `StandardAttributeProps` and the `Zitadel*EventMap` interfaces are no longer exported. Angular's `configureZitadel` is now the shared one, which registers the project once and returns the first handle if it is called again with different values.

**Upgrading:** rename these in your app, or scaffold it again; `zitadel upgrade` does not rename them for you. `@zitadel/api` moves from the dependencies of the SDKs to their development dependencies, and no value export changed.
