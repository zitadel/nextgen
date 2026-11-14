---
"@zitadel/server": patch
"@zitadel/api": patch
---

The API now answers a foreign project's session with 403, an unreachable schema URL with 400, a user attribute name that is empty or holds a `.` with 400, and creates a deployment from a release's `content_hash` instead of returning 501.
