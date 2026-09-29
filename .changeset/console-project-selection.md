---
"@zitadel/server": minor
---

Choose the project you are working on in the console's project switcher. Teams, users, user schemas, login flows, branding and the project's own settings all follow the selected project, and the selection is part of the URL, so it survives a refresh and a shared link. With a single project the console selects it for you; with several, it opens the Projects overview so you can pick one.

The sidebar lists Projects first, then the selected project's screens; the switcher's "All projects" link opens Projects too. A project's name and admins are under "Project settings" in the sidebar. Links to `/projects/{id}` still work: they open that project's settings with it selected.
