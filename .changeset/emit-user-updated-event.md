---
"@zitadel/server": minor
---

A successful `PATCH /users/{user_id}` or `PATCH /users/me` now emits a `user.updated` wide event in the same transaction as the write, carrying the touched attribute keys (and `x-audit` values, same rule as `user.created`). The event is served as a typed member of the `GET /events` union.
