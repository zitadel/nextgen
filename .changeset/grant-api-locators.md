---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Callers can create grants by user identifier or team name, not only by id. Create, get, and list name the bound person as `user` (`user_id`) or `team` (`team_id`) and drop `principal_type` / `principal_id`. `expand: ["principal"]` adds extra fields on that same object. Creating by identifier always returns 201 except self-grant; it does not reveal whether the address matched. The CLI grant commands follow the same shape: create takes `--relation` plus nested `user` / `team` locators via `--data`, and list filters `user_id` / `team_id`.
