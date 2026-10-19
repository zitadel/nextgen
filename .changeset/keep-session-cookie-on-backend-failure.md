---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A Zitadel outage or a slow response no longer signs your users out of your app. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-city` and `@zitadel/sdk-tanstack-start` checks the session cookie against `GET /sessions/me`, and cleared every `__nextgen*` cookie whenever that check failed, a `500`, a timeout or a network error included. It now clears them only when Zitadel refuses the session: a `401`, or a `404` for a session that is gone. When the check gets no answer it can act on, the request renders signed out but keeps its cookie, and a protected route answers `503 Service Unavailable` instead of redirecting a user who may well be signed in to the login page; the next request checks again. `@zitadel/sdk-core/middleware` exports the check as `checkOpaqueSessionToken`, which tells a refused session apart from one Zitadel could not judge.
