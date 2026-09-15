---
"@zitadel/server": minor
---

Callers can create grants by user identifier or team name, not only by id. Create, get, and list name the bound person as `user` (`user_id`) or `team` (`team_id`) and drop `principal_type` / `principal_id`. `expand: ["principal"]` adds extra fields on that same object.
