---
"@zitadel/sdk-next": patch
---

The Next.js middleware no longer lets an anonymous session through protected routes. It treated any live answer from the session check as signed in, but the backend answers 200 without a user for a session whose sign-in has not finished, so a visitor who had only started signing in could open a protected page. The middleware now signs a visitor in only when the answer names a user, and redirects an anonymous session to the login path while keeping its cookie so the sign-in can still complete, as the other SDKs do.
