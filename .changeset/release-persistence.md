---
"@zitadel/server": minor
---

Adds **releases** — immutable, project-scoped configuration snapshots that pin one revision of each resource they include.

A release records the revisions it pins and who assembled it, when, from which commit, and why. Assembling the same set of revisions twice returns the release that already pins them rather than a duplicate, so re-running a deploy on unchanged configuration is a no-op even when the message differs.
