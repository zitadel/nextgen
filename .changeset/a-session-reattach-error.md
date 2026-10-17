---
"@zitadel/components": patch
---

A session card or logout menu removed while its session check was failing asks again when it is put
back, and reports that answer with `zitadel-session-error`, as it already did for a missing session.
