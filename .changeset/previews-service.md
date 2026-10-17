---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /projects/{project_id}/previews` lists the project's live previews, newest first, with their expiry, and `POST /projects/{project_id}/previews/remove` ends one at once. Removing a URL with no live preview answers `204` too. Every removal is recorded in the audit stream as `preview.removed`.
