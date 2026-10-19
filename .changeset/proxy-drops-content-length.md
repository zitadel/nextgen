---
"@zitadel/sdk-core": patch
---

The proxy no longer forwards the client's `content-length` header with a re-sent body, which undici rejected as an invalid argument and which surfaced only as an opaque "fetch failed".
