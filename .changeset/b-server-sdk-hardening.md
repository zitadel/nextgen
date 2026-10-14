---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The server SDKs share one implementation of the session check, the JWT shape check and the
`loginPath` guard, exported from `@zitadel/sdk-core` as `assertLoginPath`, `parseCookieHeader` and
`clearCookie`. As a result, every server SDK reads an empty display name or identifier from the
backend as `null`, sdk-tanstack-start and sdk-next's `createProxy` reject a bad `loginPath` once at
setup instead of failing every request, and sdk-qwik-city and sdk-tanstack-start strip a
client-sent `x-nextgen-auth-token` header like the other SDKs.
