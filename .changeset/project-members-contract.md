---
"@zitadel/server": minor
"@zitadel/api": minor
---

The API reference now describes `GET /projects/{project_id}/members`, which lists everyone with a role on a project, with each person's strongest role and how they hold it, and an optional `relation` filter. It answers `501` until the list itself ships.
