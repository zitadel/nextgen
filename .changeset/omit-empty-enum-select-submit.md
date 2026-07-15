---
"@zitadel/components": patch
---

Omit empty enum `<zl-select>` fields from the flow submit payload instead
of sending `""`.

An optional select renders a leading empty placeholder option, so an
untouched field holds `""`. Because `""` is not a member of the schema's
closed `enum`, submitting it failed the server's enum validation (e.g.
`create_user` rejecting a registration with "no enum value matched"). The
orchestrator now includes a `select` field only when its value is an actual
enum member the schema allows — which includes `""` only when the schema
explicitly lists it. An omitted required select still fails the server's
required-check, surfacing a clearer "required" error than an enum mismatch.
Non-select fields keep their `""` default so required-checks and challenge
dispatch continue to run.
