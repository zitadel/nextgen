---
"@zitadel/server": patch
---

A sign-in's `session.established` and `auth.token.issued` events, and the `exchangeHandoff` request that wrote them, now carry the `flow_id` of the login flow, so `GET /events?flow_id=…` returns the whole sign-in. In the console, an event of a login flow lists that flow's events in its panel, where it listed only its own request's.
