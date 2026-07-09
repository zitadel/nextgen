---
"@zitadel/server": patch
---

Model the `__nextgen_session` cookie as an OpenAPI security scheme on
`GET /sessions/me`, `DELETE /sessions/me`, and `GET /users/me`. A missing or
invalid cookie now returns `401` with code `auth.unauthorized` and the message
`Missing or invalid session token.` (previously a missing cookie returned
`400 req.invalid` with a raw decode error).
