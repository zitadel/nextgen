---
"@zitadel/server": minor
---

User attribute errors now name the fields to fix. When `POST /users`, `PATCH /users/{user_id}` or `PATCH /users/me` refuses attributes that fail the user schema, the answer is `400 req.invalid`, the same as for a malformed body, and `details.details.fields` lists every failing field by its path from the request body, such as `attributes.country` or `attributes.address.zip`. A unique value another user holds still answers `409 user.already_exists`, and `details.details.fields` now names the attributes whose value is taken in the same form, without naming the user who holds it. Clients that matched `user.invalid` for schema failures should match `req.invalid`.
