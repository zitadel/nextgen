---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Flow engine: validate boolean and enum (select) user-schema fields at the flow step.

The field validator now accepts a real JSON boolean for `checkbox` fields (and
rejects a string), enforces a property's `const` (e.g. a must-accept terms
checkbox pinned to `true`), and enforces `required` fields — both on the submit
action and on the passkey-register issue leg. Previously these only failed later
when `create_user` validated the user against the schema; a missing required
field, an unticked must-accept box, or an unselected required dropdown now
surfaces as a per-field step error instead.
