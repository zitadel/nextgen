---
"@zitadel/server": patch
---

A Console session now needs read access to the whole target project to expand a user's teams or lifecycle owner team on `POST /users/query`, to filter on `team_id` there, or to pass `team_id` to `GET /users/{id}`. A session whose grant reaches only part of the project still gets the filtered list and the users it may read, but these membership reads are refused with `403 user.permission_denied`. Requests made with a project secret are unaffected.
