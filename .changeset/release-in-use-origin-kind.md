---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /releases/{id}/revoke` now says, for each origin in a `rel.in_use` refusal, whether it serves the release as a primary origin or a preview (`details.origins[].kind`), so a client can tell a deploy or rollback from removing the preview as the step that frees it.
