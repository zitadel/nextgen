---
"@zitadel/server": minor
"@zitadel/api": minor
---

Releases can now be deployed to environments over the API.

`POST /deployments` makes a release live on an environment, atomically: when the call returns, the environment runs the named release and an immutable record of the act exists; on any failure nothing changes. Deploying, promoting and rolling back are all this call — `reason` says which, defaulting to `deploy`, and a promotion records the environment it came from. The record keeps ids and timestamp top-level; the why-and-who (`reason`, `source_environment_id`, `deployed_by`, `deployed_by_type`) rides in a `metadata` object, every field optional. Idempotent on the running release: deploying what the environment already runs changes nothing and answers `200` with the deployment that made it live, so a re-run of `zitadel deploy` on unchanged content is a no-op end to end. An optional `expected_current_deployment_id` guards against racing another deploy: a mismatch answers `409` carrying the actual current deployment and release.

`GET /deployments` lists the log newest first — filtered to one environment, the first row is its current deployment — and `expand: ["release"]` embeds the release each deployment made live (requires `release.read`). `GET /deployments/{deployment_id}` reads one record. Environment reads now carry `current_deployment` alongside the identity, `null` until something is deployed.

Every deployment is recorded in the audit stream as `deployment.created`, by ids rather than names, so the trail survives environment renames and deletes.
