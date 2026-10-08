---
"@zitadel/server": minor
"@zitadel/api": minor
---

The API now shows who can administer a project and why. `GET /projects/{project_id}/admins` lists each person once, with every way they hold admin access: as an active member of the team that owns the project, through an admin grant to them, or through an admin grant to a team they belong to. The list follows the authorization check, so expired grants, viewer and editor grants, and people who left a team or whose team was deactivated are left out. It is ordered by user id and paginated with `page_token`. A person whose access comes only through teams the caller is not a member of is left out, and a team the caller is not in is named by its id only. `GET` and `PATCH /projects/{project_id}` now return `owning_team_id`, which is null while no team owns the project. The person who claimed a project during local setup is now listed as its admin through the owning team, though they hold no grant of their own.
