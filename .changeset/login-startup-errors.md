---
"@zitadel/components": patch
---

`<zitadel-login>` now says which attribute is wrong when it cannot start a flow: a `purpose` that is not a flow purpose (with the valid ones), a `flow-name` that is not a valid name, a project id the server refuses or does not have, and a purpose no default flow serves.
