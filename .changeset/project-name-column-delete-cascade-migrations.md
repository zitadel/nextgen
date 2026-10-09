---
"@zitadel/server": minor
---

Add a `name` column to the projects table and make project deletion cascade to all project-scoped tables via foreign keys, including team memberships.