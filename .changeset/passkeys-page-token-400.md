---
"@zitadel/server": patch
---

`GET /users/{user_id}/passkeys` answers a malformed `page_token` with
`400 req.invalid` instead of `500 internal`, like the other list endpoints.
