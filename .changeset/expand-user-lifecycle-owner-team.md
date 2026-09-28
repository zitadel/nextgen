---
"@zitadel/server": minor
---

`POST /users/query` accepts `expand: ["lifecycle_owner_team"]`, which resolves
each user's `metadata.lifecycle_owner_team_id` into the team itself at
`metadata.lifecycle_owner_team`. It is the same body `GET /teams/{team_id}`
serves, so a list of users renders its owning teams without a request per user.

The property is absent when not requested and `null` when the user is
self-owned. Expanding it requires `team.read` in addition to `user.read`; the
id alone stays unconditional.
