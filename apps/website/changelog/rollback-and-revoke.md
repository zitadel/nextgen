---
title: Roll back a deployment, and revoke a release
summary: A rollback re-deploys an earlier release to every primary origin, and a release you revoke can no longer be deployed.
date: 2026-10-22T09:55Z
cloud: true
pulls: [1852, 2123]
---

`POST /deployments/{deployment_id}/rollback` re-deploys an earlier primary deployment's release to every current primary origin, as a new deployment with `reason: rollback`. When nothing would change, it answers `200` with the newest primary deployment, and `expected_deployment_id` guards against a racing deploy with `409` `dep.conflict`.

`POST /releases/{release_id}/revoke` marks a release revoked, once: revoking it again returns it unchanged, with its first `revoked_at`, and `GET /releases` and `GET /releases/{release_id}` report it.

- A release that a primary origin or a live preview URL still serves cannot be revoked: the request answers `409` with `rel.in_use`, naming each origin and the deployment that pins it.
- Deploying a revoked release answers `409` with `rel.revoked`.

[Roll back a deployment in the API reference](https://preview.zitadel.com/docs/reference/api/deployments/rollbackDeployment)
