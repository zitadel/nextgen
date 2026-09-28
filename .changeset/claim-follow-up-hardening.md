---
"@zitadel/server": patch
---

Completing a project claim as a user without an active personal team now returns a clear 403 with code `claim.no_personal_team` instead of a 500, and owning-team grants can no longer be created with an expiry: project ownership ends only by explicit transfer or revocation, never by lapse.
