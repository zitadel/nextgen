---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": patch
"@zitadel/testing": patch
---

**Breaking:** `targets` on `POST /deployments` is `"primary"` or a list of preview URLs. `["primary"]` is refused.
