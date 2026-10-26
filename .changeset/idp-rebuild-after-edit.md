---
"@zitadel/server": patch
---

Building a release whose bundle edits an existing identity provider connection no longer fails with `500` `internal` ("failed to list identity provider connection revisions"). `zitadel deploy` after changing an IdP now builds a new release, and switching an IdP back to an earlier document reuses that earlier revision.
