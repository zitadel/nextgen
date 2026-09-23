---
"@zitadel/server": minor
---

Manage who administers a project from the console, on the project's own page (`/projects/{id}`). An Admins section below the project's details lists everyone with a grant on that project, adds an existing person as an admin, and removes that access again. Every request it makes is scoped to that project. The person has to have signed up already, because a grant binds an account rather than an email address.

The console root lands on Teams, which is where the claim flow hands a project. Settings has no Admins screen: `/settings` shows an empty Settings view until the first account setting is built.
