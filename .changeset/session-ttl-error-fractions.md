---
"@zitadel/server": patch
---

The session exchange's `sess.invalid_ttl` error reports `ttl` and `max_ttl` with their fractional seconds, instead of rounding them down to the second or writing an empty `P` below one second.
