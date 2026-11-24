---
title: List everyone with a role on a project
summary: GET /projects/{project_id}/members lists each person with a role on a project once, with their strongest role and every way they hold it.
date: 2026-11-20T13:59Z
cloud: true
pulls: [2897, 2898]
---

`GET /projects/{project_id}/members` answers who can reach a project. It lists each person once, with their strongest role, `viewer`, `editor` or `admin`, and every way they hold it: as a member of the team that owns the project, which gives `admin`, through a grant to them, or through a grant to a team they belong to.

- Pass `relation` to list only people with at least that role. `relation=admin` lists the same people as `GET /projects/{project_id}/admins`.
- Expired grants and people who left a team are left out. A direct grant to a user is listed only while that user is active.
- The list is ordered by user id and paged with `page_token`.

The admins list changed with it: both lists now show every member to every caller who may read them, with each team named. Before, a person whose access came only through a team the caller was not in was left out.

[Projects API](https://preview.zitadel.com/docs/reference/api/projects)
