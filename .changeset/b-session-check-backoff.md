---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A Zitadel server that hangs no longer slows every request. After a session check that Zitadel did
not answer, the server SDKs log the cause once and treat further checks against that server as
unanswered for five seconds without asking it again, instead of waiting out
`opaqueTokenTimeoutMs` on every request. `@zitadel/sdk-core` exports the windows as
`SESSION_CHECK_BACKOFF_MS` and `JWKS_FAILURE_BACKOFF_MS`, and `clearSessionCheckBackoff()` to end
the session-check window early.
