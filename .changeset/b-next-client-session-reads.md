---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
---

`useAuth()` in `@zitadel/sdk-next` now reports `reason: "unavailable"` when Zitadel could not be
asked about the session, as `auth()` does and as `useAuth()` in `@zitadel/sdk-nuxt` already did, so
a client component can tell an outage from a signed-out visitor instead of showing "Sign in" to a
signed-in user. `getSession()` now reads `/sessions/me` by the same rule as the server SDKs: an
answer that is not a session (an empty `{}` from a misrouted proxy, say) throws instead of reading
as signed out, and Zitadel's no-session answer reads as signed out even without its message.
`@zitadel/sdk-core` exports that rule as `readSessionAnswer`, and `toClientAuth` now also accepts a
result that is already client-safe.
