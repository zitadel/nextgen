---
"@zitadel/server": minor
---

`GET /schemas` accepts a `kind` query parameter, so you can list only the user schemas in a project instead of every schema document it has stored. The console's User schemas screen now uses it. Schemas whose stored document declares no kind are left out of a filtered result.
