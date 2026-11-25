---
"@zitadel/server": minor
---

The [events API](https://preview.zitadel.com/docs/reference/api/events) and its [webhooks](https://preview.zitadel.com/docs/reference/api/event-webhooks) have a new type, `auth.request.exchange.failed`: an app presented an authorization code and a check refused it. It carries the app's `client_id` and a `reason`, and the console's "Only failures" filter includes it. The login does not issue codes yet, so nothing writes it for now.
