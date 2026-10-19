---
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

Each SDK's root entry now also exports `AuthState` and `UnauthState`, and its `/server` entry exports `AuthResult`, `AuthState`, `UnauthState`, `NextgenSession`, `NextgenMiddlewareOptions` and `ClientAuthResult` beside `getAuth`, so a server route can type what `getAuth` returns without reaching into another entry. This matches `@zitadel/sdk-nuxt` and `@zitadel/sdk-next`.
