---
"@zitadel/server": minor
---

`POST /grants` no longer resolves the bound principal into the response: the 201 body carries only `user.user_id` or `team.team_id` on every create path, so a create by identifier cannot tell a caller whether the address matched. Read the grant back with `GET /grants/{id}` for identifier and display. Granting your own user is `grant.invalid` by `user_id` as well as by `identifier`.
