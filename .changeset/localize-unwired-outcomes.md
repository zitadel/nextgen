---
"@zitadel/server": patch
"@zitadel/components": patch
---

When a flow step does not wire an outcome such as `user_not_found`, `<zitadel-login>` now shows a translated message instead of the outcome name, in every supported locale.

The `step.error` value in the flow API changes with it. An unwired outcome now sends `error.user_not_found` for an unknown identifier, `error.user_already_exists` for an identifier of an existing account, `error.sso_user_not_found` for a provider account without a user, and `error.outcome_unhandled` for any other outcome. A value taken at account creation also sends `error.user_already_exists`. A custom login UI that checks `step.error` for an outcome name must check for these keys instead, and a custom message catalog needs entries for them.

On a sign-up step that does not wire `user_already_exists`, the flow also clears the existing account it found, so a corrected identifier or a new passkey attempt starts clean.
