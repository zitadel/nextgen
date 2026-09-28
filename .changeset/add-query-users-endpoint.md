---
"@zitadel/server": minor
---

Add `POST /users/query`, the structured-filter user list. Filter and sort by
`created_at`, `id`, `schema`, `status`, or `lifecycle_owner_team_id`, paginated
with the same cursor contract as the other query endpoints. Unlike them it
takes no `project_id` — the users list is bound to the token's own project.
