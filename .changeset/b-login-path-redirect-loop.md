---
"@zitadel/sdk-core": minor
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-tanstack-start": patch
---

A `loginPath` that `protectedRoutes` matches (for example `protectedRoutes: ["/*"]` with the
default `/login`) now logs a warning once, when the middleware is set up, naming the fix: if the
middleware runs on the login page, a visitor without a session would be redirected from it to
itself. Add the login path to `ignoredRoutes` or narrow `protectedRoutes`. Next.js and Qwik City do
not warn, since a `matcher` or a nested layout may keep their middleware off the login page.
`@zitadel/sdk-core` exports the check as `warnIfLoginPathProtected`.
