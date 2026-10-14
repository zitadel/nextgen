---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

A Zitadel outage no longer signs users out. The server SDKs now clear the session cookie only when
Zitadel itself answers that the session is gone: a `401` with the code `auth.unauthorized` or a
`404` with `sess.not_found`. On any other answer (a network error, a timeout, a `5xx`, a `429`, an
unreadable body, or a `401`/`404` page from a gateway or a wrong `url`) they keep the cookie, treat
the request as signed out for now, and answer a protected route with a retryable `503` instead of
redirecting to the login page.
