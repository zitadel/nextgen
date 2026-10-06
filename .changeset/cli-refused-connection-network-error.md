---
"@zitadel/cli": patch
---

A request that never gets a response now reports `E_NETWORK` (exit 4) however the
fetch runtime words it. The CLI recognised undici's "fetch failed" but not the
WHATWG "Failed to fetch", nor a refused connection nested in an `AggregateError`,
so those surfaced as `E_VALIDATION` (exit 3) — a different code from a platform
answering 5xx for the same unreachable server.
