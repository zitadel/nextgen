---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console no longer offers the platform project it signs in to as a project to choose: it is the root, with the projects beneath it. Its people, how they sign in and its audit log are rows of the root's sidebar beside Projects (People, Authentication, Login flows, Branding and Audit log), listed for someone who can act on the platform project, such as a platform operator. That sidebar no longer lists a project's screens; choose a project to reach them. Projects, the project switcher and search leave the platform project out, and a search hit in it reads as the page it opens. Settings keeps Billing, Support and Email, and your own profile moves to the account menu, at `/account`. `GET /users/me/projects` takes `exclude_platform` to leave the platform project out ([List my projects](https://preview.zitadel.com/docs/reference/api/projects)).
