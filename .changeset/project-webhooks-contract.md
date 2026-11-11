---
"@zitadel/server": minor
---

The API now describes webhooks for a project's events: create, list, read, update and delete a webhook and rotate its signing secret, under `/webhooks`. The operations answer `501` for now; the server code follows. See the [Webhooks reference](https://preview.zitadel.com/docs/reference/api/webhooks).
