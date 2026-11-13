---
"@zitadel/server": minor
"@zitadel/cli": minor
---

A deployment to preview URLs now records the expiry it set, and `GET /deployments`, `GET /deployments/{deployment_id}` and the create response return it as `targets[].expires_at`. A later deployment to the same URL renews the preview but leaves an earlier deployment's expiry as it was. Preview deployments made before this release report no `expires_at`.

`zitadel deployment list` now shows each deployment's kind, primary or preview, and when a preview deployment expires.
