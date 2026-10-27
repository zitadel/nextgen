---
"@zitadel/server": minor
---

`POST /auth_attempts` and `POST /sessions/exchange` take the project from the project secret and answer `403` `proj.mismatch` when the request names another one. A handoff exchange is refused once the release its sign-in started on is revoked; an invalid or expired token still answers `400` `sess.invalid_handoff_token`.
