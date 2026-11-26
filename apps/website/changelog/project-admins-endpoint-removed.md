---
title: List a project's admins with GET /projects/{project_id}/members
summary: GET /projects/{project_id}/admins is gone. Call GET /projects/{project_id}/members with relation=admin, which returns the same people with their role and how they hold it.
date: 2026-11-25T13:25Z
cloud: true
pulls: [3300]
---

`GET /projects/{project_id}/admins` no longer exists. List who administers a project with `GET /projects/{project_id}/members?relation=admin`, which the console already reads. It returns the same people under `members`, each with their `relation` and the `sources` they hold it through.

**Breaking:** calls to `/projects/{project_id}/admins` and the `listProjectAdmins` client method no longer exist. Call `listProjectMembers` with `relation=admin` instead. A self-hosted server keeps the old endpoint until you upgrade it to the release that carries this change.

[Project members in the API reference](https://preview.zitadel.com/docs/reference/api/projects/listProjectMembers)
