---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /sessions/me` now returns the signed-in user's `name` and `email` alongside `user_id`, hydrated from the conventional user-schema attributes (`name`, or `given_name` + `family_name`, and `email`). Signed-in surfaces such as `<zitadel-session>` render the human-readable identity instead of the raw user ID; both fields stay absent for anonymous sessions and schemas without those properties.
