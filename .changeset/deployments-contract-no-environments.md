---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Environments are no longer an API resource. `GET /environments` and `GET /environments/{name}` are removed, along with the `environment.created` event, and the CLI drops `zitadel environments list` and `zitadel environments get`.
