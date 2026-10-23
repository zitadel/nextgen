---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys an earlier primary deployment's release to `primary`: a new deployment with `reason: rollback` and `rollback_to` naming it, covering every current primary origin. When nothing would change it answers `200` with the newest primary deployment, and `expected_deployment_id` guards against racing another deploy with `409` `dep.conflict`. A deployment to preview URLs, or a project without a primary origin, answers `400` with `dep.invalid`.
