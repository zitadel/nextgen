---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /users/me/schema` and `GET /users/me/teams` take the same optional
`project_id` as `GET /users/me`, and answer a session of another project with
`403 sess.project_mismatch` without reading that user's schema or teams.

In `@zitadel/api`, `getMyUserSchema()` now takes its query parameters before the
request options: call `getMyUserSchema(undefined, init)` where you passed `init`
directly.
