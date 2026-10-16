---
"@zitadel/server": patch
---

`GET /sessions/me` and every other authenticated endpoint now answer `500` instead of `401` when the server cannot read its token store, for example while the database is down. Only a credential the server judged and rejected, such as a malformed, expired or revoked one, still answers `401`.
