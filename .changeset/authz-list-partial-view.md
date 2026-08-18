---
"@zitadel/server": minor
---

Management list endpoints now return a filtered view when the caller has a project foothold but only a team- or resource-scoped grant, instead of HTTP 403.
