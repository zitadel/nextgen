---
"@zitadel/server": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys an earlier deployment: a new deployment with the same release and targets, `reason: rollback`, and `rollback_to` naming the one it re-applied. Only a deployment to primary origins can be rolled back. It re-applies the variable values that deployment resolved, and refuses with `409` `dep.invalid` when any of its targets is no longer a primary origin. The operation answers `501` until the server deploys to targets.
