---
"@zitadel/server": patch
---

`PATCH /users/{user_id}` now moves a user only to another revision of its own schema, one with the same `objectType`, older or newer. A `schema` with a different `objectType` is rejected with `user.invalid`, and `details` names the user's current schema and the requested one with their `objectType`s. Before, any registered schema was accepted. Moving back to an older revision is validated like moving forward: send the attribute changes it needs, such as `null` for an attribute it does not declare. Values removed by an earlier move are not restored.
