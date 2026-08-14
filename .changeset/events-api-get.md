---
"@zitadel/server": minor
---

Add `GET /events` and `GET /events/{id}` for project audit events. List is newest-first by default (`order=desc`); pass `order=asc` for oldest-first. Callers need `events.read` (or the transitional `project.write` umbrella); pre-claim projects return an empty list or 404 until claim stamps the project team. Login/flow HTTP and `POST /projects` emit `request.api` when `project_id` is known. Path B events copy `request_id` from the HTTP request even without a token.
