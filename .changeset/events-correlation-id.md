---
"@zitadel/server": minor
---

Events carry a `correlation_id` that joins the requests of one sign-in, invitation or project claim, and `GET /events` filters by it ([docs](https://preview.zitadel.com/docs/reference/api/events/listEvents)). A sign-in shares one ID from the OAuth authorization request, or its first login step, to its session and token. An invitation's `journey_id` is that ID. A traced request's event names its trace in `metadata.trace_id`.
