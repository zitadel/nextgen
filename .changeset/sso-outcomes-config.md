---
"@zitadel/config": minor
---

The flow definition schema and plan-time validation use the renamed SSO outcomes: `sso_authenticated` (was `callback`, required on a step that offers `sso_providers`), `sso_user_not_found` (was `identity_unknown`) and the new `sso_user_already_exists`. Rename these transition keys in your flow definitions.
