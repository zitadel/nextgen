---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Environments are gone. `GET /environments`, `GET /environments/{name}` and the `environment.created` event are removed, the CLI drops `zitadel environments list` and `zitadel environments get`, and projects are created without the default `dev`, `staging` and `prod` environments. Variables belong to the project alone: `environment_name` on the variable operations answers `env.not_found`, and variables entered on an environment are removed. The deployment operations answer 501 until deployments target origins.
