---
"@zitadel/cli": patch
---

An id of `.` or `..`, and a control character in an id or in an `api` path value, is refused as a validation failure before a request is made, and `api` sends a path id without surrounding whitespace.
