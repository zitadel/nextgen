---
"@zitadel/server": patch
---

A Console session now needs read access to the whole target project to expand a user's teams or lifecycle owner team on `POST /users/query`, or to filter on `team_id`. A session whose grant reaches only part of the project still gets the filtered list, but the expansion is refused with `403 user.permission_denied`. Requests made with a project secret are unaffected.
