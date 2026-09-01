---
"@zitadel/server": minor
---

Filter sessions by team on `POST /sessions/query`. The new `lifecycle_owner_team_id` filter field returns the sessions of the users whose lifecycle that team owns — the same users it can deactivate and whose sessions it can revoke. Roster membership does not match: a collaborator on the team's roster whose lifecycle another team (or the user themselves) owns is not returned. A session stays project-scoped and carries no team, so the link is read from the user at query time; a session of a self-owned user, and a session with no user, match no team.
