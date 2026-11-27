---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Events carry a `correlation_id` that joins the requests of one sign-in, invitation or project claim. `GET /events` ([docs](https://preview.zitadel.com/docs/reference/api/events/listEvents)), `zitadel event list --filter correlation_id=…` and the console's Events search filter by it. A sign-in keeps one ID from its authorization request to its token. An invitation's `journey_id` is that ID. A traced request's event names its trace in `metadata.trace_id`.
