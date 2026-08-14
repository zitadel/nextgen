---
"@zitadel/server": patch
---

Management lists no longer attach a redundant authz EXISTS filter when the caller already has project-wide access, and the active permission catalog id is cached in-process until a new catalog is published.
