---
"@zitadel/server": patch
---

A session cookie, bearer token or flow cookie whose header names an algorithm the server never issues, or a key id that cannot be a stored key id (control or non-ASCII characters, or over-long), is now refused with `401` before the key lookup instead of reaching the database. A well-formed key id the server does not hold still answers `401`.
