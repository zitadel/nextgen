---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A Zitadel server that hangs or is down no longer slows every request. When a session check cannot
reach Zitadel (a network error, a timeout, or a `502`, `503` or `504`), the server SDKs log it once
and answer further checks against that server as unavailable for 15 seconds without asking it. A
slow answer within `opaqueTokenTimeoutMs` still counts, so a Zitadel that is slow but healthy (a
cold start, a busy database) never makes a signed-in user's session unavailable. Any other failed
check, a `500` included, holds for that request only, so a request cannot make every signed-in
user's session unavailable. The `503` a protected route answers meanwhile carries `retry-after` with
the seconds left in the window. `@zitadel/sdk-core` exports the windows as
`SESSION_CHECK_BACKOFF_MS` and `JWKS_FAILURE_BACKOFF_MS`, `clearSessionCheckBackoff()` to end the
session-check window early, and `sessionUnavailableResponse(issuerUrl)` with the matching
`retry-after`.
