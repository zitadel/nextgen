---
"@zitadel/server": patch
---

Reading an identity provider connection, its revisions or a schema by id now answers not found when the request's `project_id` names a project the resource is not in, where a project secret used to get it from its own project.
