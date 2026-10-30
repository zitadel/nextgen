---
"@zitadel/server": minor
"@zitadel/api": minor
---

Deleting a user who is the last active member of a project's owning team now fails with `409 proj.last_owner` and changes nothing. The message names the projects and says to add another member to that team, then retry. `details.details.project_ids` lists the same ids. Admin grants stay freely revocable, suspending or deactivating a user is still allowed, and a project whose owning team already has no active member is left alone.
