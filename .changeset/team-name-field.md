---
"@zitadel/server": minor
---

Teams now carry a name. It is required when creating a team and is returned by the create and get team endpoints. A team name is 1 to 200 characters. Team and project names are trimmed of surrounding whitespace, and whitespace-only names are rejected. Team names must be unique within a project, ignoring case. The same name can still be used in different projects.
