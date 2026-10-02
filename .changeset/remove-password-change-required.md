---
"@zitadel/server": minor
"@zitadel/api": minor
---

Remove `is_change_required` from `PUT /users/{user_id}/password`. It was stored but never enforced at login, so it had no effect. Requests that still send it are accepted and the field is ignored.
