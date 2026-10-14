---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

Signing in no longer hands the session token to the page's scripts. Zitadel answers the sign-in
exchange with the session token in the response body as well as in the HttpOnly session cookie, and
the `/__nextgen` proxy of every server SDK passed that body to the browser as it was, so any script
on the page could read the token the cookie keeps from it. The proxy now drops `session_token` from
that answer and keeps everything else, including the cookie. `@zitadel/sdk-core` exports the rule
as `redactExchangeBody` for a proxy of your own.
