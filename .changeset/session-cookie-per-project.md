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
that the old cookie holds a session of the app's project, the session moves to
the new cookie. With no project configured, the proxy passes cookies through
unchanged.

`@zitadel/testing` adds `sessionCookieName(projectId)`, the cookie a server-SDK
app keeps its session in, and `authenticatedPage` now signs its browser context
in under both names, so it works for SPAs and server-SDK apps alike.
`SESSION_COOKIE_NAME` stays Zitadel's own name. `@zitadel/sdk-core` adds
`sessionCookieName`, `proxySessionCookies` and `serializeSessionCookie`.
