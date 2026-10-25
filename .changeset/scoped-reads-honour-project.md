---
"@zitadel/server": patch
---

Reading an identity provider connection, its revisions or a schema by id now answers not found when the `project_id` in the request names a project the resource is not in. A project secret used to get the resource from its own project back, ignoring the `project_id` it named.
