---
"@zitadel/server": minor
---

The server no longer stores environments. Projects are created without the default `dev`, `staging` and `prod` environments, variables belong to the project alone, and `environment_name` on the variable operations answers `env.not_found`. Variables entered on an environment are removed. The deployment operations answer 501 until deployments target origins.
