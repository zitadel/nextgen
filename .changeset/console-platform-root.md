---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console no longer offers the platform project it signs in to as a project to choose. Its people, how they sign in and its audit log are in Settings instead, beside Billing, Support and Email: People, Authentication, Login flows, Branding and Audit log, listed for someone who can act on the platform project, such as a platform operator. Projects, the project switcher and search leave it out, and a search hit in it reads as the Settings page it opens. Your own profile moves from Settings to the account menu, at `/account`. `GET /users/me/projects` takes `exclude_platform` to leave the platform project out ([List my projects](https://preview.zitadel.com/docs/reference/api/projects)).
