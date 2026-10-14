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
and answer further checks against that server as unavailable for 15 seconds without asking it, and
while one check has gone a second without an answer, other requests answer at once instead of each
waiting out `opaqueTokenTimeoutMs`. Any other failed check, a `500` included, holds for that request
only, so a request cannot make every signed-in user's session unavailable. `@zitadel/sdk-core`
exports the windows as `SESSION_CHECK_BACKOFF_MS`, `SESSION_CHECK_STALL_MS` and
`JWKS_FAILURE_BACKOFF_MS`, and `clearSessionCheckBackoff()` to end the session-check window early.
