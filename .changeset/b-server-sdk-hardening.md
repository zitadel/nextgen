---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The server SDKs share one implementation of the session check, the JWT shape check and the
`loginPath` guard from sdk-core. As a result, sdk-nuxt and sdk-next read an empty display name
or identifier from the backend as `null`, sdk-tanstack-start and sdk-next's `createProxy` reject
a bad `loginPath` once at setup instead of failing every request, and sdk-qwik-city and
sdk-tanstack-start strip a client-sent `x-nextgen-auth-token` header like the other SDKs.
