---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A JWT session or bearer token is no longer signed out when the JWKS endpoint is down and no keys
are cached yet, for example right after a restart. The server SDKs keep the cookie, report
`reason: "unavailable"`, and answer a protected route `503`, as they do when the session check
cannot reach Zitadel. `@zitadel/sdk-core` exports `checkJwt`, which tells a token that could not
be checked (`unavailable`) apart from a bad one (`invalid`); `verifyJwt` still returns `null` for
both.
