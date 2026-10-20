---
"@zitadel/server": patch
---

The permission store gains an index keyed by who holds a grant, so looking up
everything one person or team can access stays fast as the number of projects
grows.
