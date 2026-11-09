---
"@zitadel/server": patch
"@zitadel/cli": patch
"@zitadel/config": patch
---

On a user schema's root or a property, a key JSON Schema does not define, such as a misspelt `minimumLength`, or an `x-` key Zitadel does not define, is now refused instead of silently constraining nothing. `zitadel deploy --dry-run` and `zitadel doctor` report it before upload, naming the schema, the property and the key.
