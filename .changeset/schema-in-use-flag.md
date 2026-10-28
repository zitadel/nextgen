---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /schemas` accepts `expand=in_use`, which adds `metadata.in_use` to each listed revision: whether any user of the project is on it. The flag is absent unless asked for, and needs read on the whole project, plus `user.read` for a token. Users are now indexed by schema, so the check and the `schema` filter on `POST /users/query` no longer read every user of the project.
