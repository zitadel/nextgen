---
"@zitadel/server": patch
---

The single-use state that links a social login back to its login attempt now keeps the OIDC nonce as issued instead of as a hash, so the callback can hand it to the id_token check. Nothing changes for users until social login ships.