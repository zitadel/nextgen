---
"@zitadel/server": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys an earlier deployment: a new deployment with the same release and targets, `reason: rollback`, and `rollback_to` naming the one it re-applied. It re-applies the variable values that deployment resolved. A deployment to preview URLs answers `400` with `dep.invalid`, and one with a target that is no longer a primary origin answers `403` with `proj.origin_not_allowed`. The operation answers `501` until the server deploys to targets.
