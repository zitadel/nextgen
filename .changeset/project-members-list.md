---
"@zitadel/server": minor
"@zitadel/api": minor
---

The API now lists everyone with a role on a project. `GET /projects/{project_id}/members` lists each person once, with their strongest role (`viewer`, `editor` or `admin`) and every way they hold it: as an active member of the team that owns the project, which gives `admin`, through a grant to them, or through a grant to a team they belong to. Pass `relation` to list only people with at least that role; `relation=admin` gives the same people as `GET /projects/{project_id}/admins`. Expired grants and people who left a team are left out, and the list is ordered by user id and paginated with `page_token`.

Both lists now show every member to every caller who may read them, with each team named. Before, a person whose access came only through a team the caller was not in was left out, so an admin added by a direct grant did not see the project's owners, and a project secret saw only people with a grant of their own.
