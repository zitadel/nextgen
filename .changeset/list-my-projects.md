---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add `GET /users/me/projects`: the list of projects the signed-in person can act
on. It answers from the grants they hold, either directly or through a team they
belong to, so the list spans projects instead of being pinned to the one the
calling credential is bound to. Authenticated with the session cookie, ordered
by project id, and paged with `limit` and `page_token`.
