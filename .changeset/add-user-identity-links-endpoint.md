---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/{user_id}/identity_links`, which lists the identity provider
accounts linked to a user, oldest first and cursor-paged. Each entry carries
the link's id, the connection id (`GET /idps/{id}` resolves it) and when the
account was linked; the provider's subject and claims are never returned. It
takes `user.read` or the console session. The generated `@zitadel/api` client
gains `listUserIdentityLinks`.
