---
"@zitadel/server": minor
---

Filter users by team: `POST /users/query` accepts a `team_id` filter field,
restricting the result to users holding an active membership in that team.
`equals` only, and it may be given once. It is filterable but not sortable.

As everywhere on the user endpoints, `team_id` is membership, not lifecycle
ownership — `lifecycle_owner_team_id` is a separate filter field answering a
different question: which team may deprovision the user.
