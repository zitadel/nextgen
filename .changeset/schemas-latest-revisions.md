---
"@zitadel/server": minor
---

`GET /schemas` takes a `revisions` parameter: `all` (the default) keeps returning every revision, and `latest` returns the newest revision of each `objectType` — one row per schema. Schemas stored without an `objectType` are returned by both. A `page_token` is bound to the mode it was issued in and is rejected by the other, and the console's user-schema directory and add-user picker now show one row per schema rather than one per edit.
