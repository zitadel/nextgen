---
"@zitadel/server": minor
---

Manage who administers a project from the console, on the project's own page (`/projects/{id}`). An Admins section below the project's details lists everyone with a grant on that project, adds an admin by email address, and removes that access again. Every request it makes is scoped to that project.

Adding by email address never says whether the address belongs to anyone: the console shows the same message every time ("If the user exists in our system, they have been granted access to your project."). Access only lands for somebody who has already signed up; the new admin shows up in the list when it does.

The console root lands on Teams, which is where the claim flow hands a project, and `/settings` shows an empty Settings view until the first account setting is built.
