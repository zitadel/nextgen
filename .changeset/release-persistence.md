---
"@zitadel/server": minor
---

Adds persistence support for **releases** — immutable, project-scoped configuration snapshots that pin one revision of each resource they include.

Release records store their pinned revisions and assembly metadata. A project-scoped content-hash index prevents duplicate snapshots and provides the storage contract needed for idempotent release orchestration in a follow-up.
