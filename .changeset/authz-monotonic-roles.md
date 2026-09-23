---
"@zitadel/server": minor
---

Project roles are now additive: `admin` implies `editor`, which implies `viewer`, never the reverse. An existing `viewer` grant no longer passes editor or admin checks. Creating a grant now requires `admin` on the project. `GET` and `PATCH /projects/{id}` accept a signed-in session for a person who holds a grant on the project.
