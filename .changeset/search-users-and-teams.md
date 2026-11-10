---
"@zitadel/server": minor
"@zitadel/api": minor
---

Find the users and teams of a project with one request. `POST /search` takes the text someone typed and the types to look for, and answers with references (`type`, `id`, `project_id`, `title`, `subtitle`), best match first. A user matches on part of the value they carry as `identifier`, a team on part of its name, and either one by its `id`. `search()` in `@zitadel/api` calls it.
