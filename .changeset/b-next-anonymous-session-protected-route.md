---
"@zitadel/sdk-next": patch
---

The middleware no longer lets a session without a signed-in user through a protected route. A
sign-in that has not verified a factor yet now redirects to the login page, as in the other
server SDKs, and keeps its cookie so the sign-in can still finish.
