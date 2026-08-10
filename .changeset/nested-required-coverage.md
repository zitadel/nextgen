---
"@zitadel/server": minor
---

A flow definition satisfies a required object in the user schema by collecting
one of its leaves. Required coverage walks the nested `required` arrays rather
than only the schema root, so a schema declaring `required: ["address"]` with
`address.required: ["street"]` is satisfied by a step collecting
`address.street`.
