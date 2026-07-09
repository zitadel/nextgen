---
"@zitadel/server": patch
---

Model the `__nextgen_session` cookie as an OpenAPI security scheme
(`nextgenSession`) on `GET /sessions/me`, `DELETE /sessions/me`, and
`GET /users/me` instead of a required cookie parameter. Credential absence is
now a security failure by construction, and a cookie that fails token
verification returns `401 auth.unauthorized` (previously `401
sess.token_invalid`), matching the missing-cookie case.
