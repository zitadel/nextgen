---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console's ⌘K search, Projects list and project switcher now find a project by name on the server, however many you can act on: `GET /users/me/projects` takes `name_contains`, and `listMyProjects()` in `@zitadel/api` accepts it. A project's Admins section no longer says your access comes from the owning team when it cannot tell.
