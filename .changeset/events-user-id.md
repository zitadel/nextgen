---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
---

Events now carry `user_id`, the user they concern whoever acted, and `GET /events?user_id=…` lists what happened to one account from an index: sign-ins with rejected passwords, sessions, credentials and changes ([Events](https://preview.zitadel.com/docs/reference/api/events)). `zitadel event list --filter user_id=…` and the console's User filter read it. Events recorded before the upgrade have no `user_id`.
