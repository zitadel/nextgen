---
title: Manage a project's origins and variables from the console
summary: The console's project page has an Overview tab with the project's origins, its variables and secrets, and its password policy, and an Admins tab.
date: 2026-10-28T11:18Z
cloud: true
pulls: [2365, 2390, 2435]
---

The console's project page now has two tabs. Overview holds the project's name, its origins, its variables and secrets, and its password policy, and the project's admins move to a tab of their own, Admins. The projects list's row menu opens the page as "View project".

- Add, edit and remove the project's origins from the page.
- Variables are listed with the value each kind holds; a secret shows only that it is configured.
- The password policy shows the minimum length and the password history in force, with a warning when the minimum is under the recommended 15 characters.

Behind it, `POST /projects/{id}/origins`, `POST /projects/{id}/origins/remove`, `GET /variables`, `GET /variables/{name}` and the policy reads accept a console session as the signed-in user, like the other project management operations. Writing a variable and publishing a policy still take the project secret.
