---
"@zitadel/server": patch
---

`POST /invitations` refuses a `metadata.name` that contains control characters or line breaks with `400 inv.invalid`, so a name can no longer forge lines in another administrator's terminal when `zitadel invitation cancel` or `zitadel invitation get` prints it.
