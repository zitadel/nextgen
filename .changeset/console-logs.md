---
"@zitadel/server": minor
---

The console has a Logs screen: a project's events, newest first, on tabs for audit events, API requests and all, filtered by category or, from any event, by its type, actor, resource, request, session or login flow. A row opens the event. `GET /events` and `GET /events/{id}` now accept the console's session cookie as well as a bearer token ([Events](https://preview.zitadel.com/docs/reference/api/events)).
