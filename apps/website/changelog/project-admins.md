---
title: See who can administer a project, and why
summary: A project's admins are listed with how each got access, through the team that owns the project, an admin grant to them, or one to a team they belong to.
date: 2026-10-26T12:08Z
cloud: true
pulls: [1508]
---

`GET /projects/{project_id}/admins` lists who can administer a project and how: through the team that owns it, an admin grant to them, or one to a team they belong to, as far as the caller may see. `GET` and `PATCH /projects/{project_id}` now return `owning_team_id`, and the person who claimed a project during local setup is listed through its owning team.

[Project admins in the API reference](https://preview.zitadel.com/docs/reference/api/projects/listProjectAdmins)
