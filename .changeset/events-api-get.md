---
"@zitadel/server": minor
---

Add `GET /events` and `GET /events/{id}` for project audit events. Callers need `events.read` (or the transitional `project.write` umbrella); pre-claim projects return an empty list or 404 until claim stamps the project team.
