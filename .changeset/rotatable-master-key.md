---
"@zitadel/server": patch
---

Support rotatable master keys. The master key wrapping each project's key encryption key (KEK) is configured under `server.master_keys`, and wrapped keys are re-encrypted under a replacement master key on startup, with new `domain.EncryptionKey` handling for encrypt/decrypt/rotation, storage v2 crypto-key persistence for PostgreSQL and Spanner, and dedicated error definitions (`encryption_key-*`).