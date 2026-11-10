---
"@zitadel/server": minor
"@zitadel/api": minor
---

Find the users, teams and configuration of a project with one request. `POST /search` takes the text someone typed and the types to look for, and answers with references (`type`, `id`, `project_id`, `title`, `subtitle`), best match first. A user matches on part of the value they carry as `identifier`, a team on part of its name, a user schema on its title or object type, a flow definition on its name, an identity provider on its slug or display name, and any of them by its `id`. `search()` in `@zitadel/api` calls it. The Console's search (⌘K) uses it: it now finds users, user schemas, login flows and identity providers of the selected project beside teams, and opens the Users list when there are more users than it shows.
