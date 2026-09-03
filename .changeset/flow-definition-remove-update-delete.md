---
"@zitadel/server": minor
"@zitadel/api": minor
---

Remove `PUT /flow_definitions/{id}` and `DELETE /flow_definitions/{id}`. A
flow definition is an immutable revision: publish a new one with
`POST /flow_definitions` to change it. Nothing emits `flowdef.updated` or
`flowdef.deleted` any more; both stay in the events API so stored rows
keep decoding.
