---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /search` on a console session without `project_id` now searches the projects the person can act on, the newest 10 that `GET /users/me/projects` lists, and says `more_projects` when there are more. The console's search finds users, teams and configuration across those projects from All projects, Projects and Settings. Teams, user schemas, flow definitions and identity providers are found by the start of a name or of a word in it, from an index, so a search costs the same in a project of any size: "staff" finds "Partner Staff", "pay" no longer finds "Prepay".
