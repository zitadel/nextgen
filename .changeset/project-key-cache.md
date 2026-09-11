---
"@zitadel/server": minor
---

Project keys are now cached in memory after their first use, so signing a token or decrypting a secret costs fewer database reads. Two new settings size the caches: `keys.encryption_key_lru_cache_size` and `keys.signing_key_lru_cache_size`, both defaulting to 1000 entries. A cached key is held for the lifetime of the server process.
