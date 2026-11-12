---
"@zitadel/cli": patch
---

`zitadel events list --fields` and `events get --fields` accept every event type's payload fields, such as `payload.operation_id` and `payload.status` for an API request. Only the `variable.set` payload's fields were accepted before.
