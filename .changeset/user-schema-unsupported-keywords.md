---
"@zitadel/server": patch
"@zitadel/cli": patch
"@zitadel/config": patch
---

A user schema key JSON Schema does not define, such as a misspelt `minimumLength`, or an `x-` key Zitadel does not define, is now refused instead of silently constraining nothing. `zitadel deploy --dry-run` reports it before upload, naming the schema, the property and the key.
