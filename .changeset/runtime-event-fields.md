---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Events emitted while serving a sign-in record the deployment and release that served it, a pinned build's included. `GET /events?release_id=…` and `zitadel event list --filter release_id=…` list them, so the outcomes of two releases, such as two variants of an A/B test of the sign-in, can be compared.
