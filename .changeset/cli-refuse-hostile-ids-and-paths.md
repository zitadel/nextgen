---
"@zitadel/cli": patch
---

An id of `.` or `..`, and a control character in an id or in an `api` path value, is now refused as a validation failure before a request is made, so a value an agent mangled gets a clear error instead of a request.
