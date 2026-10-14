---
"@zitadel/sdk-nuxt": major
---

`@zitadel/sdk-nuxt` and `@zitadel/sdk-nuxt/server` now export `NextgenSession`, `AuthState` and
`UnauthState` beside the other auth types, the same set every other server SDK exports, so a server
route can type `auth.session` directly. `event.context.nextgenAuth` is now typed as optional, since
the middleware does not run on every route, so code that reads `event.context.nextgenAuth.…`
directly no longer compiles under `strict`: read it through `getAuth(event)` instead, which answers
signed out when it is absent.
