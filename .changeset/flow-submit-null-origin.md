---
"@zitadel/server": patch
---

`POST /flow/{id}/submit` now checks an opaque `Origin` (`null`), which browsers send from sandboxed frames and `data:` pages, against the project's origins, so a project that lists its origins refuses it with `req.invalid` instead of skipping the check.
