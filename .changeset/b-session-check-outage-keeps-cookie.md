---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A Zitadel outage no longer signs users out. When the session check gets a network error, a
timeout or a 5xx, the server SDKs keep the session cookie and treat the request as signed out
for now, and a protected route answers a retryable 503 instead of redirecting to the login page.
Only a 401 or 404 from the backend clears the cookie. `validateOpaqueSessionToken` in
`@zitadel/sdk-core` now returns `live`, `dead` or `unknown` instead of a session or `null`, and
`handleNextgenRequest` in `@zitadel/sdk-tanstack-start` can return an `unavailable` decision.
