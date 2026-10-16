---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/me/schema`: the schema the signed-in user's own record is validated against, the one `PATCH /users/me` validates against. Like the rest of `/users/me` it is self-access, authorized by the session alone, so a person can build a profile form from it without holding a grant in their project. The `@zitadel/api` client gains `getMyUserSchema()`.
