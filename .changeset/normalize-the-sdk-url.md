---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-tanstack-start": patch
"@zitadel/sdk-qwik-router": patch
---

A `ZITADEL_URL` or `url` option that ends in a slash, or carries stray whitespace, no longer breaks sign-in. Previously the SDKs requested `//auth/keys` and `//sessions/me` and rejected every token on an issuer mismatch; they now strip the whitespace and trailing slashes once, and the issuer check stays strict against that normalized url. A `url` that is empty, only whitespace or only slashes now counts as unset in every SDK, including the Nuxt runtime config, so it falls back to `ZITADEL_URL` and then to `http://localhost:8080`.
