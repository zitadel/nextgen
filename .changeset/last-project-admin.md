---
"@zitadel/server": minor
"@zitadel/api": minor
---

Revoking the last admin grant, deleting the last person who can administer a project, or deactivating a team that is their only way in now fails with `409 proj.last_admin` and changes nothing. The message names the projects and says to grant `admin` to someone else, then retry. `details.details.project_ids` lists the same ids. A project that already has nobody who can administer it is left alone. Viewer and editor grants, deleting a user or team that does not exist, and deactivating a team that still owns a project (`team.owns_project`) are unchanged. Platform operators and the project secret do not count as someone who can administer the project.
