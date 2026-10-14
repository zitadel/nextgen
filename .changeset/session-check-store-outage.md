---
"@zitadel/server": patch
---

`GET /sessions/me` and every other authenticated endpoint now answer `500` instead of `401` when the server cannot read its token store, for example while the database is down. Clients no longer mistake an outage for a signed-out session and keep their session cookie; a malformed, expired or revoked credential still answers `401`.
