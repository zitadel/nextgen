---
"@zitadel/config": patch
---

The flows README that `zitadel setup` writes into `.zitadel/flows/` now explains how to let a user who forgot their password back in: set a new one with `zitadel api setUserPassword`, since a flow can't offer a recovery step yet.
