---
"@zitadel/components": patch
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Submit `<zl-checkbox>` values as real JSON booleans so boolean-typed schema
properties validate on `create_user`.

A `checkbox` field maps to a JSON `type: boolean` property. The orchestrator
previously submitted the checkbox's value token (`"true"`) when checked and
`""` when unchecked, both of which are strings — so the server's schema
validation rejected the user with `user.invalid` whether the box was ticked
or not, making a boolean field impossible to submit. The orchestrator now
coerces a checkbox to a real boolean (`true` when checked, `false`
otherwise), and the flow field validator accepts a boolean for `checkbox`
fields (and rejects a string) so the value reaches `create_user` with the
type its schema declares.
