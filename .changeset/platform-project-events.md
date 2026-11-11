---
"@zitadel/server": minor
---

Platform operators (`platform.operators`) now see every project's events, including projects nobody has claimed yet: in the console's Logs, on a project's Overview, and through `GET /events` and `GET /events/{id}` ([Events](https://preview.zitadel.com/docs/reference/api/events)). The project's own secret and everyone else still see none until the claim. The Logs for the Platform project list its events too: the deployment's platform project (`platform.bootstrap_project` or `platform.project_id`) needs no claim. An enabled event export now ships every project's events, from the oldest one still retained.
