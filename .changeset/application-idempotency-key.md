---
"@zitadel/server": minor
---

`POST /applications` now honors the `Idempotency-Key` header for 24 hours. A retry with the same key and body writes no revision. It replaces the secrets of the clients the first request created and returns the new ones, so a lost response no longer loses the secrets. The same key with another body is refused with `422 app.idempotency_key_reused`. See [`publishApplication`](https://preview.zitadel.com/docs/reference/api/applications/publishApplication).
