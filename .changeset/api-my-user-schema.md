---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add two self-access reads: `GET /users/me/schema`, the schema the signed-in user's own record is validated against (the one `PATCH /users/me` validates against), and `GET /users/me/teams`, their own team roster. Like the rest of `/users/me` they are authorized by the session alone, so a person can build a profile form and see their teams without holding a grant in their project. The `@zitadel/api` client gains `getMyUserSchema()` and `listMyTeams()`.
