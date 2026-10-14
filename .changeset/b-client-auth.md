---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-qwik-city": minor
"@zitadel/sdk-tanstack-start": minor
---

Every server SDK now has `getClientAuth()`, the auth state without the session token, safe to
return from a server function, load, loader or server action. The documented TanStack Start guard
returned `getAuth(context)` from a server function, which sent the HttpOnly session token to the
browser; return `getClientAuth(context)` there instead. `getAuth()` (and `auth()` in sdk-next) still
carries the token for server-side use only. `@zitadel/sdk-core` exports the conversion as
`toClientAuth`.
