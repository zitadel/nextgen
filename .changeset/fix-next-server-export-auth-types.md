---
"@zitadel/sdk-next": patch
---

`@zitadel/sdk-next/server` now exports `AuthResult`, `AuthState`, `UnauthState`, `NextgenSession`, `ClientAuthResult` and `NextgenMiddlewareOptions` beside `auth`, so a Server Component can type what `auth()` returns without reaching into another entry.
