---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /deployments/{deployment_id}/rollback` re-deploys a primary deployment's release to its targets, with `reason: rollback` and `rollback_to` naming it. A preview deployment does not roll back, and a target that is no longer a primary origin of the project answers `403` with `proj.origin_not_allowed`. When the targets already serve the release, nothing changes and the call answers `200`.
