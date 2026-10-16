---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A malformed token no longer writes an error to your logs. A request whose `Authorization` header or
session cookie held something token-shaped but not decodable (`Bearer x.y.z`, a header with a
numeric `alg`) logged `verifyJwt unexpected error` with a stack trace, once per request, so anyone
could flood the log. Such a token is now simply rejected, and the error log is kept for failures on
the server's own side, such as a malformed signing key.
