---
"@zitadel/server": patch
---

A sign-in step reached through `user_already_exists` now always checks the password. Before, the check was skipped when an earlier step in the flow declared an `on_success` mutation, such as `create_user` on the registration step that raised the collision. That mutation never runs on a collision, so the flow could sign in to the existing account with any password. A wrong password now shows the step again with `error.invalid_credentials`.