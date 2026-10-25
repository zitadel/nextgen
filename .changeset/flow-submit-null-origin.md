---
"@zitadel/server": patch
---

`POST /flow/{id}/submit` now checks an opaque `Origin` (`null`), which browsers send from sandboxed frames and `data:` pages, against the project's origins like any other origin. A project that lists its origins refuses such a submission with `req.invalid`; it used to skip the check for an origin without a host.
