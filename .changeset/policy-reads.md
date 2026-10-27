---
"@zitadel/server": minor
---

`GET /policies?project_id=…` lists a project's policies at their newest revision, `GET /policies/{policy_id}` reads one and `GET /policies/{policy_id}/revisions` pages its history; the reads also accept a console session ([docs](https://preview.zitadel.com/docs/reference/api/policies/listPolicies)). A policy's `config` is typed per operation, and a refused publish lists every failed setting or rule in `details.details.violations`.
