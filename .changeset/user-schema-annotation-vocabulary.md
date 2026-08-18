---
"@zitadel/server": minor
"@zitadel/config": minor
---

User schemas can now declare `x-audit: true` on a property, allowlisting that
attribute's value for audit event payloads. Payloads stay deny-by-default:
without it, an attribute contributes its key but never its value.

`x-verify`, `x-editable`, `x-sensitive` and `x-mfa` are no longer part of the
dialect. Nothing read them. A schema that still carries one keeps validating,
since a property accepts annotations the dialect does not name, but they are no
longer documented or offered by editor completion.
