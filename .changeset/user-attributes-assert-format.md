---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": minor
---

User attributes must now match their schema's `format`. Creating a user, patching one and signing up all refuse a value like `not-an-email` for a `format: email` property, with `attributes_invalid` naming the attribute, so `zitadel users create` and `users update` do too. This covers the standard JSON Schema formats, such as `email`, `uri`, `uuid`, `date` and `date-time`. Any other format, such as `phone`, stays a label.

A value stored before this change does not block a patch to another attribute, but moving that user to another schema requires correcting it in the same request.

A `--user-file` bootstrap document that creates a user is held to `format` too: a bad value now stops the server from starting, naming the attribute. A user the document already created is skipped as before.
