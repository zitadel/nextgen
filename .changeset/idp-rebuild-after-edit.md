---
"@zitadel/server": patch
---

Building a release that edits an existing identity provider connection, as `zitadel deploy` does after you change one, no longer fails with `500` `internal`, and switching a connection back to an earlier document reuses that revision.
