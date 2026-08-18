---
"@zitadel/server": minor
"@zitadel/api": minor
---

Nest a user's schema-defined content under `attributes`. `POST /users` takes `schema` plus an `attributes` document, and every user response carries `id`, `schema`, `attributes` and `metadata`. The user schema now validates `attributes` alone, so closed-world keywords such as `additionalProperties: false` behave as their author intended and a schema may declare a property named `id` or `metadata`. The schema pointer is named `schema` rather than `$schema`, and `POST /users` answers with the same representation a read returns.

A user is stored as its attribute rows, so an empty `attributes` document is
rejected with `user.invalid`, even where the schema itself accepts it. `POST
/users` also documents its `500`: when the user was created but could not be
read back, the body carries its id in `details.user_id`, and the caller should
fetch that user rather than repeat the create.
