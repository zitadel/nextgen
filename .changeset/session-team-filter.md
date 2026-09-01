---
"@zitadel/server": minor
---

Filter sessions by team on `POST /sessions/query`. The new `lifecycle_owner_team_id` filter field returns the sessions of the users whose lifecycle that team owns — the same users it can deactivate and whose sessions it can revoke. Roster membership does not match: a collaborator on the team's roster whose lifecycle another team (or the user themselves) owns is not returned. A session stays project-scoped and carries no team, so the link is read from the user at query time; a session of a self-owned user, and a session with no user, match no team.

The change also ships an index-only schema migration: `sessions` gains `(project_id, created_at, id)` and `(project_id, user_id)`, and on SQLite `users` gains the lifecycle-owner index the other dialects already had. It adds no column or table, but it does close a pre-existing gap — before it, every page of `POST /sessions/query` scanned and sorted a project's whole session table (127 ms for an unfiltered first page at 2M sessions, against 0.44 ms after). On PostgreSQL the indexes build under a `SHARE` lock, so session writes block for the duration of the migration; reads are unaffected.
