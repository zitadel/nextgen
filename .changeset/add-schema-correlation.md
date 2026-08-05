---
"@zitadel/server": patch
---

Add schema correlation via `objectType`: schemas now persist this field, and 
`GET /schemas` can filter by `objectType`.