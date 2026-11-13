---
"@zitadel/server": patch
---

On `auth.token.issued`, `token_id` is now the credential that made the request, as on every other event, and no longer the issued token; read the issued token from `entity_id`.
