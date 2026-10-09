---
"@zitadel/server": minor
---

`POST /idps/query` and `GET /idps/{id}` accept a Console session cookie as the signed-in user, so the Console can read a project's identity provider connections without a project secret. Creating and revising connections still needs the secret.
