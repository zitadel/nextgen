---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /teams/query` now accepts an omitted `project_id` and defaults to the credential's project, matching `POST /users/query`; explicit project IDs still use the existing authorization checks.
