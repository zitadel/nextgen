---
"@zitadel/server": patch
---

An SSO `return_target` whose path a browser or proxy could read as another host is now refused with `400 req.invalid`, and the sign-in callback checks the stored target again before redirecting.
