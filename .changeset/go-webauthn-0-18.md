---
"@zitadel/server": patch
---

Update the server's Go dependencies, among them go-webauthn 0.18. A passkey sign-in still reports whether that sign-in verified the user, and client extension outputs nobody asked for are still accepted.
