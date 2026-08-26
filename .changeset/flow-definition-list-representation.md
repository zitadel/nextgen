---
"@zitadel/server": minor
---

`GET /flow_definitions` now returns each row as the same `{id, project_id, flow_definition, created_at, updated_at}` representation that `GET /flow_definitions/{id}` returns, so a list row carries the flow's name, status, user schema, purposes and steps. The flat summary it returned before is gone, and with it the `schema_uri` field, which the response declared but the server never populated. Clients that read `name` or `status` from the top level of a list row must read them from `flow_definition`.