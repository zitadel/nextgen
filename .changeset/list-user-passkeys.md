---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/{user_id}/passkeys` to list a user's registered passkeys, 
returning each passkey's `id`, `name`, and `created_at`. Requires an OAuth2 
bearer with the `user.read` scope.

Registered passkeys now get a name of their own instead of reusing the user's 
display name, which was the same for every passkey a user registered (and empty 
whenever the flow collected no identifier). A passkey takes the name the 
registering caller supplies, and otherwise one derived from the credential 
itself: `Security key`, `Synced passkey`, or `Device-bound passkey`.
