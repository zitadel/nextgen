---
"@zitadel/server": patch
---

Management list queries now fail closed if the authz list filter is missing from the request, instead of returning every row in the project.
