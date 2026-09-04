---
"@zitadel/server": minor
"@zitadel/api": minor
---

Flow definitions are revisioned: `POST /flow_definitions` publishes a new
revision on every call, so a repeated `name` no longer returns 409, and
`GET /flow_definitions` accepts a `name` filter that lists one flow's
revisions newest first.
