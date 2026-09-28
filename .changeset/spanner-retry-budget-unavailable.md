---
"@zitadel/server": patch
---

Report a contended database transaction as a retryable failure instead of an
unexplained internal error. A read-write transaction that used up its retry
budget under contention returned HTTP 500 with no detail and nothing in the
logs; it now returns HTTP 503 with an `unavailable` code, and the server logs a
warning naming the elapsed time. The retry budget itself is unchanged in
production at 30 seconds, and is looser against the Cloud Spanner emulator,
which serializes transactions process-wide and can starve a long one for
reasons that do not apply to a real instance.
