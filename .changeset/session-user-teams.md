---
"@zitadel/server": minor
---

`GET /users/{id}/teams` accepts the Console session cookie. Like the membership expansion on `POST /users/query`, a session reads a user's roster when it holds `viewer` on the user's project; a team-scoped foothold gets 403 on the memberships and no grant gets 404. Project secrets keep requiring the `team_membership.read` scope.
