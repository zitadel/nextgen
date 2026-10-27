---
"@zitadel/sdk-core": patch
---

Signing out through a server SDK's `/__nextgen` proxy now also ends a session still held in the shared `__nextgen_session` cookie, which Zitadel kept valid until it expired because that sign-out carried no CSRF token.
