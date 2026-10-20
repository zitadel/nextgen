---
"@zitadel/server": minor
"@zitadel/api": minor
---

Deleting a team that still owns a project is refused with `409 team.owns_project` instead of deactivating it and leaving the project without an owner. The `deleteTeam` contract carries the new status and error code.
