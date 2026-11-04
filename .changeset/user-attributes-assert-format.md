---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": minor
"@zitadel/components": minor
---

User attributes must now match their schema's `format`. Creating a user, patching one and signing up all refuse a value like `not-an-email` for a `format: email` property, with `attributes_invalid` naming the attribute, so `zitadel users create` and `users update` do too. This covers the standard JSON Schema formats, such as `email`, `uri`, `uuid`, `date` and `date-time`. Any other format, such as `phone`, stays a label.

**Breaking:** values stored before this change get no exception. A patch to a user holding a value that fails its `format` is refused until the same request corrects it, and a stored identifier that fails its `format` no longer signs in or starts recovery. Correct such values through `PATCH /users/{id}` or `zitadel users update`.

In a login flow, a blank optional field with a format counts as unset, and a `date-time` field gets a date and time input.

A `--user-file` document that creates a user with a bad value now stops the server from starting.
