---
"@zitadel/sdk-nuxt": patch
---

`@zitadel/sdk-nuxt` and `@zitadel/sdk-nuxt/server` now export `NextgenSession`, `AuthState` and `UnauthState` beside the other auth types, so a server route can type `auth.session` directly. `event.context.nextgenAuth` is now typed as optional, since the middleware does not run on every route; read it through `getAuth(event)`, which answers signed out when it is absent. This is a type-level change: user code that reads `event.context.nextgenAuth.isAuthenticated` without `?.` no longer compiles until it uses `?.` or `getAuth(event)`.
