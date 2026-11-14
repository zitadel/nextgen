---
"@zitadel/server": patch
---

A passkey sign-up with an email that already has an account now shows that the account exists before the browser asks to save a passkey. Before, the browser saved the passkey first and the server refused it, which left an unusable entry in the password manager.