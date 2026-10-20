---
"@zitadel/api": minor
"@zitadel/server": minor
---

A Console session can open users, teams, schemas, login flows, and branding by id in any project it holds a grant on, not only in the project it signed in to. `GET /schemas/{id}` takes an optional `project_id`, because schema ids are unique per project only; without it an id that exists in several projects resolves in the caller's own project. Project secrets still resolve ids in their own project only.
