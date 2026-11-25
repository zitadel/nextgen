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

**Breaking:** the names that carried the alpha codename now say Zitadel: `createNextgenHandle`, `createNextgenOnRequest`, `createNextgenRequestMiddleware`, `createNextgenMiddleware` and `nextgenMiddleware` are `createZitadelHandle`, `createZitadelOnRequest`, `createZitadelRequestMiddleware`, `createZitadelMiddleware` and `zitadelMiddleware`; `NextgenSession` is `ZitadelAuthSession`; `NextgenMiddlewareOptions` is `ZitadelMiddlewareOptions`; `NextgenProvider` is `ZitadelProvider`; `NextgenHandle` is `ZitadelHandle`; in TanStack Start `NextgenRequestOptions`, `NextgenRequestDecision` and `handleNextgenRequest` are `ZitadelRequestOptions`, `ZitadelRequestResult` and `handleZitadelRequest`; the `nextgenAuth` key on `event.locals`, `event.context` and the Qwik shared map is `zitadelAuth`; the internal header is `x-zitadel-auth-token`; the Qwik Router route file is `plugin@zitadel.ts`; and the Nuxt module key and variables are `zitadel` and `NUXT_ZITADEL_*`, `useState("nextgen-auth")` is `useState("zitadel-auth")`, and `runtimeConfig.public.nextgenProxyPath`, `nextgenApiBase` and `NUXT_PUBLIC_NEXTGEN_*` are `zitadelProxyPath`, `zitadelApiBase` and `NUXT_PUBLIC_ZITADEL_*`. A Nuxt app that keeps any old Nuxt name now fails to build or to start instead of losing its `protectedRoutes`. The legacy `__nextgen_session` cookie is no longer handled; the server already refuses that name. The `/__nextgen` proxy path is unchanged. Also: `@zitadel/sdk-tanstack-start/react` is `@zitadel/sdk-tanstack-start/components`; the Angular classes lose their `Component` suffix and need Angular 19 or newer (`zitadel setup` now refuses Angular 17 and 18); their inputs are read-only signals (`input()`), so code that assigned an input directly (`component.project = value`) must bind it in a template or call `setInput`, and code that read it as a plain value reads `component.project()`; `ZitadelLoginProps` and its siblings are one type per widget, and in Angular they are the inputs only; the flow types come from `@zitadel/sdk-core` (`ZitadelFlowPurpose`, `ZitadelFlowStep`, `ZitadelFlowBehavior`) instead of the generated client; every UI SDK no longer re-exports `ZitadelLoginConfig`, `ZitadelLogoutConfig`, `ZitadelSessionConfig`, the `*Handlers` types, `ZitadelNavigationDetail` or the wrapper attribute types (`ZitadelWidgetAttributes`, `WithZitadelWidgetAttributes`, `Zitadel*ReactProps` and `Zitadel*SvelteProps`); the config, handler and navigation types are in `@zitadel/sdk-core/types`; the `./components` entry of `@zitadel/sdk-tanstack-start` no longer re-exports the session, event and widget-name types; and the helper types `ZitadelWidgetName`, `ZitadelWidgetTag`, `ZitadelStandardAttributeName`, `ZitadelStandardAttributes`, `ZitadelStandardAttributeProps` and the `Zitadel*EventMap` interfaces are no longer exported. The `getSession` option type of `@zitadel/sdk-next` is the `@zitadel/sdk-core` type, which is not a breaking change. Angular's `configureZitadel` is now the shared one, which registers the project once and returns the first handle if it is called again with different values. Every exported type of every SDK now carries the `Zitadel` prefix, so it no longer collides with the types of an app or of an auth library. The most visible renames are `AuthResult` to `ZitadelAuthResult`, `AuthState` to `ZitadelAuthState`, `UnauthState` to `ZitadelUnauthState`, `ClientAuthResult` to `ZitadelClientAuthResult`, `ClientSession` to `ZitadelClientSession`, `AuthOptions` to `ZitadelAuthOptions`, `ProxyHandler` to `ZitadelProxyHandler` and `SessionStore` to `ZitadelSessionStore`.

**Behavior:** an empty `url` or `projectSecret` now counts as unset in every server SDK and falls back to the next source, `projectSecret` is an option of every server SDK except the Nuxt module, and `protectedRoutes` also matches the percent-decoded path, so `/%61dmin` is protected like `/admin`.

**Upgrading:** rename these in your app, or scaffold it again; `zitadel upgrade` does not rename them for you. `@zitadel/api` moves from the dependencies of the SDKs to their development dependencies, and no value export changed.
