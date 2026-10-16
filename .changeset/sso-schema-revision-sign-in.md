---
"@zitadel/server": patch
---

Users linked to a sign-in provider keep signing in after their user schema is republished. A user stays on the schema revision it was created under, and a flow runs against the newest revision, so every change to a schema used to end each existing provider sign-in in `409` with `flow.restart_required`. A provider account whose email (or another unique value) belongs to a user of an older revision now reaches the `user_already_exists` route instead of the same `409`. Revisions are now matched by the schema's `objectType`; a user of a different schema is still refused.
