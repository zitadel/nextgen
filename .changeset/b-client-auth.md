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
return from a server function, load, loader or server action, where the result is serialised to
the browser. `getAuth()` (and `auth()` in sdk-next) still carries the token for server-side use
only, so return `getClientAuth()` from anything the browser receives. `@zitadel/sdk-core` exports the conversion as
`toClientAuth`.
