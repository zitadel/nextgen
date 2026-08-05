---
"@zitadel/components": patch
---

Automation hooks for auth-method credential fields are now method-named,
matching what the docs have always promised: a flow field named
`x-auth-methods#password` renders `data-testid="zitadel-field-password"`
and `zitadel-input-password` instead of leaking the raw field name into
the hooks. The `name` attribute (the wire/form key) is unchanged.
Scripts that targeted the raw `zitadel-field-x-auth-methods#password`
form must switch to the documented method-named hooks.
