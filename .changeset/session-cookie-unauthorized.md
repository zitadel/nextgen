---
"@zitadel/server": patch
---

Unauthenticated requests to cookie-secured endpoints (`GET`/`DELETE /sessions/me`, `GET /users/me`) now return `401` with the stable code `auth.unauthorized` instead of `400 req.invalid`, matching the documented OpenAPI contract. API error responses no longer serialize internal diagnostics (`parent`, `location`) into `details`, and security errors return a normalized message instead of raw framework text.
