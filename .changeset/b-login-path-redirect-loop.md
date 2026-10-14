---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A `loginPath` that `protectedRoutes` matches (for example `protectedRoutes: ["/*"]` with the
default `/login`) now fails when the middleware is set up, with an error naming the fix, instead
of redirecting every visitor without a session from the login page to itself. Add the login path
to `ignoredRoutes` or narrow `protectedRoutes`. `assertLoginPath` in `@zitadel/sdk-core` takes the
routes as an optional second argument.
