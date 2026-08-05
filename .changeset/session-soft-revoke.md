---
"@zitadel/server": minor
---

Revoking a session now soft-deletes it: the record is kept and reported with
`state: revoked` instead of being removed, so revoked sessions stay visible on
`GET /sessions/{id}`. Tokens derived from a revoked session are rejected.
