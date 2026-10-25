---
"@zitadel/cli": patch
---

`zitadel start` now waits until the local server's database answers, not only its process, and `zitadel doctor`, `zitadel status` and `zitadel setup` count a local server as healthy only when its database answers too. They ask the server's `/readyz` probe instead of `/healthz`.
