---
"@zitadel/server": minor
"@zitadel/api": minor
---

Events carry `deployment_id`, `release_id` and `target` when a deployment served the request that caused them, and `GET /events` filters by `release_id` and `deployment_id`.
