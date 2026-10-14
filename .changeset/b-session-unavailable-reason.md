---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-qwik-city": minor
"@zitadel/sdk-tanstack-start": minor
---

Your own guards can now tell a Zitadel outage from a signed-out visitor. When the session could
not be checked, `getAuth()` (and `auth()` in sdk-next, `useAuth()` in sdk-nuxt) returns
`{ isAuthenticated: false, session: null, reason: "unavailable" }` and the cookie is kept. Answer a
retryable error there instead of redirecting to the login page, for example
`if (auth.reason === "unavailable") error(503)` before the redirect. The `UnauthReason` type is
exported from every server SDK.
