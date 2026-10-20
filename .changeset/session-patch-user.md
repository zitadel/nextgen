---
"@zitadel/server": patch
---

Updating a user (`PATCH /users/{user_id}`) now accepts the Console session cookie as the signed-in user, so the Console can save edits to a user.
