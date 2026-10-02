---
"@zitadel/server": patch
---

The console's user detail page shows a user's passkeys again when you are signed in. `GET /users/{user_id}/passkeys` now accepts the console session as well as a project secret, so the Passkey row no longer reads "Could not be loaded".
