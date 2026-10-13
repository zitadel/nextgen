---
"@zitadel/server": minor
---

Deployments target origins instead of environments. `POST /deployments` names the release by `release_id` or `content_hash` and takes `targets`: `primary` for every primary origin of the project, or exact origins. It answers the deployment, and a stale `expected_deployment_id` answers `409` with `dep.conflict` carrying the actual newest deployment. A deployment carries its resolved `targets` and `rollback_to` in its metadata; `promote` and the source environment fields are gone. `GET /deployments` filters by `origin` and takes `live=true` for what each target serves now. A release referencing a variable with no value answers `400` with `dep.variables_missing`, naming the missing variables; a changed variable value makes the same release a new deployment. The deployment operations answer `501` until the server deploys to targets.
