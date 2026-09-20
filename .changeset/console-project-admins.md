---
"@zitadel/server": minor
---

Manage who administers a project from the console: Settings now has an Admins screen listing everyone with a grant on the project, adding an existing person as an admin, and removing that access again. The person has to have signed up already, because a grant binds an account rather than an email address.

The console root and Settings no longer render a page explaining that a screen does not exist: `/` lands on Teams, which is where the claim flow hands a project, and `/settings` lands on the new Admins screen.
