---
"@zitadel/server": minor
---

`POST /policies?project_id=…` publishes a password policy as a new revision, with optional `min_length`, `max_length` and `history_depth`, and `GET /policies/revisions/{revision_id}` reads one back ([docs](https://preview.zitadel.com/docs/reference/api/policies/publishPolicy)). The newest revision applies the next time a password is set; existing passwords are not re-checked. The new scopes are `policy.read` and `policy.write`.
