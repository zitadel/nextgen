---
"@zitadel/server": minor
---

Show each user's teams in the console users list. The memberships ride along on
`POST /users/query` with `expand: ["teams"]`, so the column costs no request per
row, and a user on more teams than the embedded list carries says so rather than
presenting the cap as the whole roster. A credential that may not read
memberships keeps the list and loses the column.
