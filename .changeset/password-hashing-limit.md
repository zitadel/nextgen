---
"@zitadel/server": minor
"@zitadel/api": minor
---

Each server process limits concurrent password hashing, so a burst of sign-ins no longer exhausts memory or stalls other requests; by default the budget follows the container's memory limit. Tune it under `password_hasher.concurrency`. A request that finds no room within `max_wait` gets `429 Too Many Requests` with `Retry-After` and code `user.password_hashing_busy`: safe to retry, never a failed sign-in.
