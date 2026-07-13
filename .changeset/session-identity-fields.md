---
"@zitadel/server": patch
---

`GET /sessions/me` hydrates the authenticated user's identity: the session
response gains optional `name` (from the conventional `name` property, else
`given_name` + `family_name`) and `email` fields. Signed-in surfaces such as
`<zitadel-session>` now greet users by name or email instead of the raw
`user_…` id.
