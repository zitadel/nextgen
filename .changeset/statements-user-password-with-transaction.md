---
"@zitadel/server": patch
---

Wrap Spanner SetUserPassword update-then-insert in withTransaction so both writes share one transaction.
