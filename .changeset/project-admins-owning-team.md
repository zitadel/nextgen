---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /projects/{project_id}/admins` lists who can administer a project and how: through the team that owns it, an admin grant to them, or one to a team they belong to, as far as the caller may see ([docs](https://preview.zitadel.com/docs/reference/api/projects/listProjectAdmins)). `GET` and `PATCH /projects/{project_id}` now return `owning_team_id`, and the person who claimed a project during local setup is listed through its owning team.
