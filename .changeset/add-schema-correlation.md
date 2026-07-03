---
"@zitadel/server": patch
---

Add schema correlation via `objectType`: schemas now persist this field, 
`GET /schemas` can filter by `objectType`, and list responses include each 
schema's `objectType`.