---
"@zitadel/server": minor
---

Serve the project management endpoints: `getProject` now returns the full project state, `patchProject` renames a project, and `queryProjects` lists the project the caller's secret is bound to. Invalid list requests (bad page token, unusable filter value) answer 400 instead of 500.