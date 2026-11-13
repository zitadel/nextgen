---
"@zitadel/server": minor
---

You can now manage webhooks for a project's events: create, list, read, update and delete a webhook and rotate its signing secret, under `/webhooks`. The server stores them and records each change as a `webhook.*` event, but does not deliver events to them yet. See the [Webhooks reference](https://preview.zitadel.com/docs/reference/api/webhooks).
