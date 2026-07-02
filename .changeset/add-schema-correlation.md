---
"@zitadel/server": patch
---

Add user-schema correlation via `userType`: schemas now persist this field, 
`GET /schemas` can filter by `userType`, and list responses include each 
schema's `userType`.