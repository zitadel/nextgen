---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-sveltekit": patch
---

The sdk-next README now lists the client session's real fields (`userId`, `identifier`,
`identifierProperty`, `display`), and its agent skill names `/client` as a client-safe import and
`ZITADEL_PROJECT_SECRET` among the settings. The sdk-core and sdk-sveltekit READMEs describe JWKS
caching as it works: the issuer's whole key set is cached for five minutes, and a token naming an
unknown `kid` refreshes it at most every 30 seconds.
