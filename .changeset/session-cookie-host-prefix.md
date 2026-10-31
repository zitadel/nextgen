---
"@zitadel/server": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-qwik-router": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/cli": minor
"@zitadel/testing": minor
"@zitadel/api": patch
"@zitadel/components": patch
---

The session cookie is now `__Host-zitadel_session`, which a browser accepts only from Zitadel's own host over https, so another site under the same domain can no longer plant a session. On `http://localhost` it is `zitadel_session`, so sign-in keeps working in Safari. An app's own, behind a server SDK or dev proxy, adds `_<project id>`.

**Breaking:** every browser signs in again: cookies named `__nextgen_session` are no longer read. Update the server, the server SDKs, the CLI and `@zitadel/testing` together; an SDK from before this release keeps no session with this server, nor the other way round. In `@zitadel/testing`, `SESSION_COOKIE_NAME` is `__Host-zitadel_session`, and `sessionCookieName(projectId, url)` and the new `browserSessionCookieName(url)` name the cookies for the app's URL. `zitadel doctor` fails on the dev proxy of a single-page app set up before this release until `zitadel doctor --fix` updates it.
