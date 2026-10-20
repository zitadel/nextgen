---
"@zitadel/server": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys the release of an earlier primary deployment to every current primary origin: a new deployment with `reason: rollback` and `rollback_to` naming it, answering `201`. When that release is live already nothing changes and the call answers `200`. A deployment to preview URLs, or a project with no primary origin, answers `400` with `dep.invalid`; `expected_deployment_id` guards the write like a deploy.
