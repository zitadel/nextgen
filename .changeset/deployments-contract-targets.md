---
"@zitadel/server": minor
---

Deployments target origins instead of environments. `POST /deployments` names the release by `release_id` or `content_hash` and takes `targets`: `primary` for every primary origin of the project, or exact origins. It answers the deployment, and a stale `expected_deployment_id` answers `409` with `dep.conflict` carrying the actual newest deployment. A deployment carries its resolved `targets` and `rollback_to` in its metadata; `promote` and the source environment fields are gone. `GET /deployments` filters by `origin` and takes `live=true` for what each target serves now. The deployment operations answer `501` until the server deploys to targets.
