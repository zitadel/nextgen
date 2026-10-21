---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/me/passkeys` and `GET /users/me/identity_links`: the signed-in user's own passkeys and linked identity provider accounts, readable with the session alone. Like the other `/users/me` reads they take an optional `project_id`, and refuse a session of another project with `403 sess.project_mismatch`. The `@zitadel/api` client gains `listMyPasskeys()` and `listMyIdentityLinks()`.
