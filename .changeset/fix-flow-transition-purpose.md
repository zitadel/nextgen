---
"@zitadel/server": patch
---

Fix flow-definition upload dropping each transition's `purpose` field, which
left the login flow's Sign Up link unable to switch the flow into
registration mode.
