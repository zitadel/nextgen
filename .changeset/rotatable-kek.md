---
"@zitadel/server": patch
---

Support rotatable key encryption keys (KEKs). Encryption keys can now be re-encrypted under a replacement KEK, with new `domain.EncryptionKey` handling for encrypt/decrypt/rotation, storage v2 crypto-key persistence for PostgreSQL and Spanner, and dedicated error definitions (`encryption_key-*`).