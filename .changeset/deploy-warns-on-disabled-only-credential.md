---
"@zitadel/cli": minor
---

`zitadel deploy` and `deploy --dry-run` now also warn when the config disables a sign-in method that some existing users depend on, such as passkeys for users who signed up with only a passkey. The warning names the schema and the method and counts those users.
