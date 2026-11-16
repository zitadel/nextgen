---
title: Deleting a user revokes their grants, and never leaves a project without an owner
summary: Deleting a user now revokes every grant they held, and fails with 409 proj.last_owner when they are the last active member of a project's owning team.
date: 2026-10-30T08:57Z
cloud: true
pulls: [2438, 2398]
---

`DELETE /users/{user_id}` now revokes every grant the user held, on any project, in the same transaction, and records an `authz.revoked` event for each one on that grant's project. Before, the grants stayed behind and kept appearing in the grants query with only the user's id.

Deleting a user who is the last active member of a project's owning team now fails with `409` `proj.last_owner` and changes nothing. The message names the projects and says to add another member to that team, then retry, and `details.details.project_ids` lists the same ids.

- Admin grants stay freely revocable, and suspending or deactivating a user is still allowed.
- A project whose owning team already has no active member is left alone.

[Delete a user in the API reference](https://preview.zitadel.com/docs/reference/api/users/deleteUser)
