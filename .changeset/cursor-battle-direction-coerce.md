---
"@zitadel/server": patch
---

Reject keyset page tokens whose sort direction no longer matches, and coerce credential resource IDs as strings so cursor paging no longer fails after the first page.
