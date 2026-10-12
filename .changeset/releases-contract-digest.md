---
"@zitadel/server": minor
---

Every release carries `content_hash`, a `sha256:`-prefixed digest of the content it pins, which a client can compute from `.zitadel/` before sending it. `GET /releases` takes a `content_hash` filter that answers the one release with that digest or an empty list.
