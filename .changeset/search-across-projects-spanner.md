---
"@zitadel/server": patch
---

On Spanner, `POST /search` without `project_id` no longer fails with a 500 for a person who can act on more than five projects.
