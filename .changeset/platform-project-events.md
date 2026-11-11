---
"@zitadel/server": patch
---

The console's Logs for the Platform project now list its events: `GET /events` and `GET /events/{id}` read the deployment's platform project (`platform.bootstrap_project` or `platform.project_id`) without a claim, and an enabled event export ships its retained events too.
