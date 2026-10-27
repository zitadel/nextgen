---
"@zitadel/sdk-core": patch
---

Signing out through a server SDK's `/__nextgen` proxy now also ends a session of the app still held in the shared `__nextgen_session` cookie, as from a sign-in before the SDKs gave each app its own session cookie. Zitadel refused that sign-out because it carried no CSRF token, so the cookie was cleared but the session stayed valid on the server until it expired.
