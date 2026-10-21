---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/me/passkeys`, `GET /users/me/identity_links` and `GET /users/me/password`: the signed-in user's own passkeys, linked identity provider accounts and password state, readable with the session alone. Like the other `/users/me` reads they take an optional `project_id`, and refuse a session of another project with `403 sess.project_mismatch`. The `@zitadel/api` client gains `listMyPasskeys()`, `listMyIdentityLinks()` and `getMyPasswordState()`.
