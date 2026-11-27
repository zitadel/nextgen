---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": patch
---

[`getProjectClaim`](https://preview.zitadel.com/docs/reference/api/projects/getProjectClaim) (`GET /projects/{project_id}/claim`) says whether a project is claimed and by which team. `zitadel status` and `zitadel doctor` use it, so a project claimed from another machine no longer reads as temporary, and `zitadel claim` and `zitadel doctor --fix` record its team in `.zitadel/secret`.
