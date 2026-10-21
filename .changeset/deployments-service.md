---
"@zitadel/server": minor
"@zitadel/api": minor
---

Releases can now be deployed to a project's primary origins with `POST /deployments` and `targets: ["primary"]`, which covers every primary origin. Deploying the release that is already live answers `200` and writes nothing, and `expected_deployment_id` guards against racing another deploy with `409` `dep.conflict`.
