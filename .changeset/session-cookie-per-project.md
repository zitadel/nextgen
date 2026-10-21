---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-qwik-router": minor
"@zitadel/testing": minor
---

The server SDKs now keep each app's session in a cookie named after its
project, `__nextgen_session_<project id>`, instead of the `__nextgen_session`
cookie every project on a host shared. On `localhost`, signing in to an app no
longer signs you out of the Console of `zitadel start` or of another app, and
signing in to the Console no longer signs you out of your apps.

The `/__nextgen` proxy renames the cookie Zitadel sets on its way to the
browser, sends the app's cookie to Zitadel under Zitadel's name, and passes no
other project's session cookie on. Users who signed in before the upgrade stay
signed in: the first time the middleware, or the widgets' session check, finds
that the old cookie holds a session of the app's project, the session is copied
to the new cookie. The old cookie stays until the user next signs in or out
through the app, since the Console may share the app's project; then the proxy
clears it, and on sign-out ends its session too, so it cannot sign the user
back in. A response that sets a session cookie is never stored by a shared
cache (`Cache-Control: private, no-store`). With no project configured, the
proxy passes cookies through unchanged.

If your server-SDK app reads the session cookie itself, or its tests set it,
use `sessionCookieName(projectId)` (from `@zitadel/sdk-core`, or from
`@zitadel/testing` in tests) instead of `__nextgen_session` or
`SESSION_COOKIE_NAME`: the app's session is no longer kept there.

`@zitadel/testing` adds `sessionCookieName(projectId)`, the cookie a server-SDK
app keeps its session in, and `authenticatedPage` now signs its browser context
in under both names, so it works for SPAs and server-SDK apps alike.
`SESSION_COOKIE_NAME` stays Zitadel's own name. `@zitadel/sdk-core` adds
`sessionCookieName`, `proxySessionCookies`, `serializeSessionCookie` and
`SESSION_COOKIE_CACHE_CONTROL`.
