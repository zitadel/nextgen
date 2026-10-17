---
"@zitadel/server": minor
---

`GET /releases`, `GET /releases/{release_id}`, `GET /deployments` and `GET /deployments/{deployment_id}` accept a Console session cookie as the signed-in user, so the Console can read a project's releases and where each went without a project secret. Building and revoking releases, and deploying, still need the secret.
