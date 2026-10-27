---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys an earlier primary deployment's release to every current primary origin, as a new deployment with `reason: rollback` ([docs](https://preview.zitadel.com/docs/reference/api/deployments/rollbackDeployment)). When nothing would change it answers `200` with the newest primary deployment, and `expected_deployment_id` guards against a racing deploy with `409` `dep.conflict`.
