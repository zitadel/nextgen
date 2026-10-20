---
"@zitadel/server": patch
---

The key caches now report to whichever metric exporter `instrumentation.metric` is configured with: `zitadel.cache.lookups` (split into hits and misses), `zitadel.cache.evictions`, and `zitadel.cache.entries`. Each carries a `cache` attribute naming the cache it came from, so the crypter and signing key caches read separately.
