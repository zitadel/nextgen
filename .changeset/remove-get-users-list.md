---
"@zitadel/server": major
---

Remove `GET /users`. `POST /users/query` replaces it, matching projects and
teams, which have no `GET` collection either. Callers move from
`listUsers({ limit, page_token })` to `queryUsers({ limit, page_token })`,
which additionally accepts `filter` and `sorting`.
