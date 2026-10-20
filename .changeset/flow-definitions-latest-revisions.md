---
"@zitadel/server": minor
---

`GET /flow_definitions` takes a `revisions` parameter, matching `GET /schemas`: `all` (the default) keeps returning every revision, and `latest` returns the newest revision of each `name` — one row per flow. A `page_token` is bound to the mode it was issued in and is rejected by the other, and the console's login-flows directory now shows one row per flow rather than one per published revision.
