---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/me/schema` and `GET /users/me/teams`: the signed-in user's own schema and team roster, readable with the session alone. Every `/users/me` endpoint now answers a refused session with `401 auth.unauthorized`. The `@zitadel/api` client gains `getMyUserSchema()` and `listMyTeams()`.
