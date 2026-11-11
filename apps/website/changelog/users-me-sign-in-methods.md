---
title: Read a signed-in user's own sign-in methods
summary: Three new /users/me reads return the signed-in user's passkeys, linked identity provider accounts and password state, with the session alone.
date: 2026-10-21T14:48Z
cloud: true
pulls: [2202, 1886]
---

`GET /users/me/passkeys`, `GET /users/me/identity_links` and `GET /users/me/password` return the signed-in user's own passkeys, linked identity provider accounts and password state, readable with the session alone. Like the other `/users/me` reads, they take an optional `project_id`, and refuse a session of another project with `403 sess.project_mismatch`. The `@zitadel/api` client gains `listMyPasskeys()`, `listMyIdentityLinks()` and `getMyPasswordState()`.

`GET /users/{user_id}/password` reports when a user's current password was set, as `set_at`, and never returns the password or its hash. It takes `user.read`, or a console session with access to the user's project, and the client gains `getUserPasswordState`.

[Users in the API reference](https://preview.zitadel.com/docs/reference/api/users)
