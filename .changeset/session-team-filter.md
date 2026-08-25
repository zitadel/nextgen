---
"@zitadel/server": minor
---

Filter sessions by team on `POST /sessions/query`. The new `team_id` filter field returns the sessions of the users on that team's roster; a session stays project-scoped, so one session appears under every team its user belongs to, and a session with no user belongs to none.
