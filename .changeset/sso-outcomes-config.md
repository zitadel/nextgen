---
"@zitadel/config": minor
---

The flow definition schema and plan-time validation use the renamed SSO outcomes: `sso_authenticated` (was `callback`, required on a step that offers `sso_providers`) and `sso_user_not_found` (was `identity_unknown`). Rename these transition keys in your flow definitions. `user_already_exists` keeps its name: the SSO collision shares it with the typed one.
