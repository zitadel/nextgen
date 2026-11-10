---
"@zitadel/server": minor
---

The console has a Logs screen: a project's events, newest first, with each event's type, what it was about, who caused it and when. A row opens the event with its values and its JSON document. `GET /events` and `GET /events/{id}` now accept the console's session cookie as well as a bearer token ([Events](https://preview.zitadel.com/docs/reference/api/events)).
