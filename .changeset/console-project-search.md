---
"@zitadel/server": minor
"@zitadel/api": minor
---

Find a project by name in the console, however many you can act on: the ⌘K search, the Projects list and the project switcher search on the server rather than in the projects already loaded. `GET /users/me/projects` takes `name_contains`, a case-insensitive name search that pages like the full list, and the `@zitadel/api` client's `listMyProjects()` accepts it. A project's Admins section no longer says your access comes from the owning team when it cannot tell where it comes from.
