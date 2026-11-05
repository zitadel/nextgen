---
"@zitadel/server": minor
---

A project secret can no longer read a granted platform user's profile through the grants API, and a project that has not been claimed can no longer grant platform users or teams.

**Breaking:** `expand=principal` on `GET /grants/{id}` and `POST /grants/query` now answers 403 `user.permission_denied` unless the caller can read the platform project. `POST /grants` on a project that has not been claimed answers 403 `grant.project_unclaimed`; claim the project first.
