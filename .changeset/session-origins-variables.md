---
"@zitadel/server": minor
---

The origins operations (`POST /projects/{id}/origins` and `POST /projects/{id}/origins/remove`) and the variable reads (`GET /variables` and `GET /variables/{name}`) accept a Console session cookie as the signed-in user, so the Console can manage a project's origins and show its variables; variable writes still take the project secret.
