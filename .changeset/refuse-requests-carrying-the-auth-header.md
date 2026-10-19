---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

Refuse any request that carries an `x-nextgen-auth-token` header with a 400 "Bad Request" in all six server SDKs, on every route including ignored routes and the proxy path, instead of removing or overwriting the header. This is a behaviour change for clients: the header is an internal channel that only the SDK sets after verifying a session, so a client that sends it, for example a script that copies headers from a previous response, is now rejected.
