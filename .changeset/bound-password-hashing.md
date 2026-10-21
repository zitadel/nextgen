---
"@zitadel/server": minor
---

The server now bounds how many passwords it hashes or checks at once, so a burst of sign-ins no longer exhausts memory or stalls every other request. Configure it under `password_hasher.concurrency`: `max_operations` (default: one per CPU), `memory_budget` (default 512 MiB, shared by all running hashes, with memory-hard hashes taking a larger share) and `max_wait` (default 1s). A request that finds no room within `max_wait` is answered with `429 Too Many Requests`, a `Retry-After` header and the error code `user.password_hashing_busy`; it is safe to retry and never counts as a failed sign-in. The new `zitadel.password_hashing.*` metrics report hashes running, waiting and refused.
