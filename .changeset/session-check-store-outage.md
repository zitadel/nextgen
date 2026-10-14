---
"@zitadel/server": patch
---

`GET /sessions/me` and every other authenticated endpoint now answer `500` instead of `401` when the server cannot read its token store, for example while the database is down. Clients no longer mistake an outage for a signed-out session and keep their session cookie; a malformed, expired or revoked credential still answers `401`. A token or flow cookie whose header names an algorithm the server never issues, or a key id that cannot be a stored key id (for example one with control or non-ASCII characters, or an over-long one), is now refused before the key lookup instead of reaching the database. A well-formed key id the server does not hold still answers `401`.
