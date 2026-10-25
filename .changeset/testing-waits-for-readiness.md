---
"@zitadel/testing": patch
---

`withZitadel` now waits for the instance's `/readyz`, which answers once its database does, instead of `/healthz`, so a suite starts against an instance that can serve requests.
