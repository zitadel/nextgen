---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
---

`POST /users/query` can find the users still on an older revision of a schema. The new `schema_object_type` filter field matches the object type every revision of a schema shares, with `equals`, `not_equals` and `contains`, and `schema` now accepts `not_equals`, so `schema_object_type` `equals` a type together with `schema` `not_equals` its newest revision lists the users left to migrate. `zitadel users list --filter` accepts `schema_object_type`.
