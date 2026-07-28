---
"@zitadel/server": minor
---

Teams now carry a name. It is required when creating a team and is returned by the create and get team endpoints. Team and project names are trimmed of surrounding whitespace, and whitespace-only names are rejected.
