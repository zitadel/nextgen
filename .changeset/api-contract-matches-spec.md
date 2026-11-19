---
"@zitadel/server": patch
"@zitadel/api": patch
---

The API now answers a foreign project's session with 403, an unreachable schema URL with 400, a user attribute name that is empty or holds a `.` with 400, a passkey registration whose `rp_id` is not a domain with 400 in the spec as well as at the server, an OAuth settings revision with 404 instead of 500, and creates a deployment from a release's `content_hash` instead of returning 501.
