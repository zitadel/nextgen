---
"@zitadel/server": patch
"@zitadel/components": patch
---

A flow step that does not wire the outcome a handler raised is shown again with a localized `error.*` message instead of the outcome name: `error.user_not_found` for an unknown identifier, `error.user_already_exists` for an identifier of an existing account, `error.sso_user_not_found` for a provider account without a user, and `error.outcome_unhandled` for any other outcome. The login page carries these messages in every supported locale.
