---
"@zitadel/server": minor
"@zitadel/cli": minor
---

Find a user by the value they carry as `identifier`: `POST /users/query` and `zitadel users list --filter` accept `identifier` with `contains`, and the Console's Users list has a search field that uses it across every page. A filter value containing a NUL byte or invalid UTF-8 now answers 400 on any text filter.
