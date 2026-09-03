---
"@zitadel/server": minor
"@zitadel/api": minor
---

Remove `PUT /flow_definitions/{id}` and `DELETE /flow_definitions/{id}`. A
flow definition is an immutable revision: publish a new one with
`POST /flow_definitions` to change it. The `flowdef.updated` and
`flowdef.deleted` event types are gone from the events API with them.
