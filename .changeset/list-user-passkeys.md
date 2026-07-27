---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/{user_id}/passkeys` to list a user's registered passkeys, returning each passkey's `id`, `name`, and `created_at`. Requires an OAuth2 bearer with the `user.read` scope.
