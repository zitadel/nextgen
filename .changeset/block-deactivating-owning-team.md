---
"@zitadel/server": minor
---

Deleting a team that still owns a project is refused with `409 team.owns_project` instead of deactivating it and leaving the project unmanageable. Transfer or revoke the project ownership first.
