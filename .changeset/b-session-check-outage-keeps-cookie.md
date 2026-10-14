---
"@zitadel/sdk-core": major
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": major
---

A Zitadel outage no longer signs users out. The server SDKs now clear the session cookie only when
Zitadel itself answers that the session is gone: a `401` with the code `auth.unauthorized` or a
`404` with `sess.not_found`. On any other answer (a network error, a timeout, a `5xx`, a `429`, an
unreadable body, or a `401`/`404` page from a gateway or a wrong `url`) they keep the cookie, treat
the request as signed out for now, and answer a protected route with a retryable `503` instead of
redirecting to the login page. `validateOpaqueSessionToken` in `@zitadel/sdk-core` now returns
`{ status: "live" | "dead" | "unknown" }` instead of a session or `null`: check
`.status === "live"` and read `.session`. `handleNextgenRequest` in `@zitadel/sdk-tanstack-start`
can now return an `{ type: "unavailable", response }` decision; send its `response`.
