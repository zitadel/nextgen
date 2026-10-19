---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The Next.js middleware no longer lets an anonymous session through protected routes. It treated any 200 answer from the session check as signed in, but the backend answers 200 without a user for a session whose sign-in has not finished, so a visitor who had only started signing in could open a protected page. The middleware now signs a visitor in only when the answer names a user, redirects an anonymous session to the login path while keeping its cookie so the sign-in can still complete, and clears the cookie of a session the backend does not hold. An empty, non-JSON or null-user answer is no longer read as signed in either. The Nuxt server middleware now shares the same session check as the other SDKs, so a user id that is not a non-empty string no longer counts as signed in there.
