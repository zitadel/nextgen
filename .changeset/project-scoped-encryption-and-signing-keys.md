---
"@zitadel/server": minor
"@zitadel/api": minor
---

Give every project a full key set at creation. The project data-encryption key now wraps purpose-scoped keys — token, secret and cookie encryption plus an EdDSA token signing key — and callers resolve them by purpose instead of sharing one DEK. Adds a `signing_keys` table and per-purpose "one active key per project" constraints.
