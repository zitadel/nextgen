---
"@zitadel/server": minor
---

Answer `POST /grants` by `user.identifier` with 202 and no body on every outcome, so a hit, a duplicate, a miss and an ambiguous lookup are one response and nothing about the address leaks. Keep 201 for the `user.user_id` and team locators, whose body carries only `user.user_id` or `team.team_id`; read the grant back with `GET /grants/{id}` for identifier and display. Reject granting your own user with `grant.invalid` by `user_id` as well as by `identifier`.
