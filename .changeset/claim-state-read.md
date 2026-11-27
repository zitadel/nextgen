---
"@zitadel/server": minor
"@zitadel/cli": patch
---

The server adds `GET /projects/{project_id}/claim` (`getProjectClaim`), which answers whether a project is claimed, with its owning team and claim time, on the project secret and without a claim challenge. `zitadel status` and `zitadel doctor` use it when `.zitadel/secret` records no owning team, so a project claimed from another machine, or a secret restored from a backup, no longer reads as temporary and no longer suggests `zitadel claim`. When the server cannot be reached they keep reporting the local record.
