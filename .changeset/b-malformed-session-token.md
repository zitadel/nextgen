---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A session cookie that cannot be a Zitadel session token (a percent-encoded newline, spaces,
non-ASCII characters, or a value far too long) is now treated as signed out and cleared without
asking Zitadel. Before, such a cookie made the session check fail as if Zitadel were down, so one
request could show every signed-in user an unavailable session. A `200` from `GET /sessions/me`
that is not the session (no `session_id`) now counts as an unchecked session too, rather than
signing anyone in. `@zitadel/sdk-core` exports the check as `isWellFormedSessionToken`, with
`MAX_SESSION_TOKEN_LENGTH`.
