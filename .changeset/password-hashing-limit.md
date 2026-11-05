---
"@zitadel/server": minor
"@zitadel/api": minor
---

The server limits concurrent password hashing, so a burst of sign-ins no longer exhausts memory or stalls other requests; tune it under `password_hasher.concurrency`. A request that finds no room within `max_wait` (default 1s) gets `429 Too Many Requests` with `Retry-After` and the code `user.password_hashing_busy`. It is safe to retry and never counts as a failed sign-in.
