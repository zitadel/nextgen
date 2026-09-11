---
"@zitadel/server": minor
---

Project keys are now resolved once and kept in memory, so an authenticated request no longer re-reads its encryption key from the database and re-unwraps it with the master key on every call. Two new settings size the caches: `keys.crypter_lru_cache_size` and `keys.signing_key_lru_cache_size`, both defaulting to 1000 entries. Cached entries are dropped when the cache is full and when the server restarts; which key is currently active is never cached, so a future key rotation still takes effect immediately.
