---
"@zitadel/server": minor
---

Embed a user's team memberships on `POST /users/query` with
`expand: ["teams"]`, saving a request per user. The property is omitted when
not requested and `[]` when the user has none. Embedded lists are capped at 10
with `teams_truncated`; the whole list stays at `GET /users/{user_id}/teams`.
