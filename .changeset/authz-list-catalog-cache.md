---
"@zitadel/server": patch
---

Management lists skip the authz EXISTS filter for one compile when Check already returned project-wide Allow. That skip does not re-check RSI dual-write, and a grant revoked between Check and SELECT can still appear. Forbidden lists still get the EXISTS partial view.
