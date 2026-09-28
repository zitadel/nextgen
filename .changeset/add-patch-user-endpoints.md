---
"@zitadel/server": minor
---

Add `PATCH /users/{user_id}` and `PATCH /users/me` to the API: partial attribute updates with null-deletes, validated as a whole against the user's schema, with an optional schema move on the management endpoint.
