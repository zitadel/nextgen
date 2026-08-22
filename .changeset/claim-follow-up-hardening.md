---
"@zitadel/server": patch
---

`claim/complete` now answers 403 with code `claim.no_personal_team` (previously an opaque 500) when the session user has no active personal team to attach the claimed project to, and the database schema now rejects owning-team grants that carry an expiry (ADR 054: ownership ends by transfer or revocation, never by lapse).
