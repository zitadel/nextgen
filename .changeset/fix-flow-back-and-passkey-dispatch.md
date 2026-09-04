---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Fix two sign-in dead ends. Choosing "sign in with a passkey" on a password step
no longer verifies the password field the browser posts alongside it, so the
WebAuthn prompt appears instead of `error.invalid_credentials`. And going back
to the identifier step now releases the user resolved by the abandoned attempt,
so re-entering an address signs in normally instead of failing with "The user
was already authenticated".
