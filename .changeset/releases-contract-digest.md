---
"@zitadel/server": minor
---

Every release carries `content_hash`, its `sha256:`-prefixed content digest over the sorted pointer set. `GET /releases` takes a `content_hash` filter that answers the one release with that digest or an empty list.
