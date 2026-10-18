---
"@zitadel/server": patch
---

The OpenAPI document now describes the requests a webhook sink set under
`events.export` receives: one entry under `webhooks` per event type, each with
the event JSON the server POSTs and how a delivery is acknowledged or retried.
The API reference has a page per event type, under Event webhooks.
