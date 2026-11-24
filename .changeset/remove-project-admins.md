---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /projects/{project_id}/admins` is removed; list a project's admins with [`GET /projects/{project_id}/members?relation=admin`](https://preview.zitadel.com/docs/reference/api/projects/listProjectMembers).

**Breaking:** calls to `/projects/{project_id}/admins` and the `listProjectAdmins` client method no longer exist. Call `listProjectMembers` with `relation=admin`: it returns the same people, under `members`, each with `relation` and `sources`.
