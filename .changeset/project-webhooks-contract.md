---
"@zitadel/server": minor
---

A project can now send its events to webhooks: manage them under `/webhooks` or on the console's Webhooks page, and the server POSTs each event a webhook names to its URL as soon as it is stored, signed, with retries. See the [Webhooks reference](https://preview.zitadel.com/docs/reference/api/webhooks) and [Verify a webhook's signature](https://preview.zitadel.com/docs/guides/verify-webhook-signatures).

**Upgrading a self-hosted server:** delivery is on by default (`events.webhooks.enabled`). A server that runs only while it serves a request sets `events.webhooks.trigger_secret` and has a scheduler call `/cron/events-webhooks`, as for `/cron/events-retention`; with `events.webhooks.wake.url` it also tells an endpoint of yours when a project has events to send, so they need not wait for the scheduler ([configuration](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#webhook-delivery)).
