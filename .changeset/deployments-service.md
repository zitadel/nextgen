---
"@zitadel/server": minor
"@zitadel/api": minor
---

Releases can now be deployed to a project's primary origins. `POST /deployments` names the release by `release_id` and takes `targets`: `primary`, which expands to every primary origin of the project, or exact primary origins. The deployment records the resolved origins, and a deployment to origins that already serve the release answers `200` and writes nothing. `expected_deployment_id` guards against racing another deploy with `409` `dep.conflict`.
