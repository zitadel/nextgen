---
"@zitadel/server": minor
---

`GET /schemas` now pages by cursor: it takes `limit` (default 20, max 100) and `page_token`, returns `next_page_token`, rejects malformed or mismatched page tokens with `req.invalid`, and drops the never-implemented `offset` parameter.
