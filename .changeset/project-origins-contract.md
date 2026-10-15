---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
---

Project create/get/query now return typed `origins` (`pattern` + `kind`) instead of `preview_origins`. Nested `POST /projects/{id}/origins` and `.../origins/remove` are available (server returns 501 until the origins service ships).
