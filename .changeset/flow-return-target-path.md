---
"@zitadel/server": patch
---

An SSO flow submit now refuses a `return_target` whose path starts with `//` or `/\`, also once `.` and `..` segments are resolved, with `400 req.invalid`. Such a target is on the request origin, but a proxy that re-bases the callback's redirect onto its own host would read the path as another host and send the browser there after sign-in.
