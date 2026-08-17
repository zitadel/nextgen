---
"@zitadel/server": minor
"@zitadel/config": minor
---

User schemas can now declare `x-audit` and `writeOnly` on a property.
`x-audit: true` allowlists an attribute's value for audit event payloads, which
stay deny-by-default and otherwise record only that the attribute was written.
`writeOnly` marks a value that should never be returned by the read API —
accepted today, not yet enforced.

`x-verify`, `x-editable`, `x-sensitive` and `x-mfa` are no longer part of the
schema dialect. Nothing read them. A schema that still carries one keeps
validating, since a property accepts annotations the dialect does not name, but
they are no longer documented or offered by editor completion.
