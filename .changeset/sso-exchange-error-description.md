---
"@zitadel/server": patch
---

When an identity provider refuses the code exchange, the server log now includes the provider's `error_description`, for example `invalid client_id / client_secret` for a wrong client secret.
