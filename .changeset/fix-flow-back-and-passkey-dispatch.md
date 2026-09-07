---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Fix three sign-in dead ends. Choosing "sign in with a passkey" on a password
step no longer treats the password box the browser posts alongside it as a
submission, so the WebAuthn prompt appears instead of a required-field or
invalid-credentials error. Going back to the identifier step now releases the
user resolved by the abandoned attempt, so re-entering an address signs in
normally instead of failing with "The user was already authenticated". And
signing up with an address that already has an account now completes: that
sign-in reached the final step without a handoff token, leaving the user
unable to exchange it for a session.
