---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": minor
---

User attributes must now match their schema's `format`. Creating a user, patching one and signing up all refuse a value like `not-an-email` for a `format: email` property, with `attributes_invalid` naming the attribute, so `zitadel users create` and `users update` do too. This covers the standard JSON Schema formats, such as `email`, `uri`, `uuid`, `date` and `date-time`. Any other format, such as `phone`, stays a label.

A value stored before this change does not block a patch to another attribute, and a stored identifier still signs its user in and starts recovery. Moving that user to another schema requires correcting the value in the same request.

In a login flow, a blank optional field with a format counts as unset. A `date-time` field now renders as a text input that takes an RFC 3339 timestamp, because a date input cannot produce one.

A `--user-file` bootstrap document that creates a user is held to `format` too: a bad value now stops the server from starting, naming the attribute. A user the document already created is skipped as before.
