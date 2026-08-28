---
"@zitadel/server": minor
---

`GET /schemas` accepts a `kind` query parameter, so you can list only the user schemas in a project instead of every schema document it has stored. The console's User schemas screen now uses it.

The `schema.created` audit event carries the schema's kind and object type, where it previously carried an empty payload.
