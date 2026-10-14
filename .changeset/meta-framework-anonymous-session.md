---
"@zitadel/sdk-core": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The SvelteKit, SolidStart, Qwik City and TanStack Start SDKs no longer treat an anonymous session as signed in. The backend sets the session cookie before a sign-in verifies any factor, so an abandoned sign-in left a live session with no user, which these SDKs reported as authenticated (user `"unknown"`) and let past `protectedRoutes`. Like the Nuxt SDK, they now sign in only a session that names a user, and keep an anonymous session's cookie so its sign-in can still complete. The signed-in session now carries the user's `identifier`, `identifierProperty` and `display` on every framework, and a dead session cookie is cleared on every unauthenticated response, not only on redirects. The check is the new shared `validateOpaqueSessionToken` in `@zitadel/sdk-core/middleware`.
