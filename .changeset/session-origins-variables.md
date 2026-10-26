---
"@zitadel/server": minor
---

`POST /projects/{id}/origins`, `POST /projects/{id}/origins/remove`, `GET /variables` and `GET /variables/{name}` accept a Console session cookie as the signed-in user, like the other project management operations, so the Console can manage a project's origins and show its variables. Variable writes still take the project secret.
