---
"@zitadel/server": patch
---

`GET /sessions/me` and every other authenticated endpoint now answer `500` instead of `401` when the server cannot read its token store, for example while the database is down. Clients no longer mistake an outage for a signed-out session and keep their session cookie; a malformed, expired or revoked credential still answers `401`. That includes a token or flow cookie whose header names a key id or algorithm the server never issues, which is now refused before the key lookup instead of reaching the database.
