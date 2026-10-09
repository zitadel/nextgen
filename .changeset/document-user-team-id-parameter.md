---
"@zitadel/server": patch
---

Document what `team_id` does on the user endpoints. On `POST /users` it adds
the new user to that team and scopes team-unique attributes; on
`GET /users/{user_id}` it serves the user only when they hold an active
membership there. Both are membership, not lifecycle ownership — which is
reported as `metadata.lifecycle_owner_team_id` and cannot be set through the
API. No request or response shape changed.
