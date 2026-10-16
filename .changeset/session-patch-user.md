---
"@zitadel/server": minor
"@zitadel/api": patch
---

`PATCH /users/{user_id}` accepts a Console session cookie as the signed-in user, so the Console can save a user's attributes without a project secret. Like the other cookie writes it needs the CSRF token, and its error response now declares `auth.csrf_invalid`.
