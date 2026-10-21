---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-tanstack-start": patch
"@zitadel/sdk-qwik-router": patch
---

A `ZITADEL_URL` or `url` option that ends in a slash no longer breaks sign-in. Previously the SDKs requested `//auth/keys` and `//sessions/me` and rejected every token on an issuer mismatch; they now join the backend address and the path properly, and the issuer check stays strict against the address without its trailing slash.
