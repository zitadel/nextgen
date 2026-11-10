---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/api": minor
---

Find a user by the start of the value they carry as `identifier`: `POST /users/query` and `zitadel users list --filter` accept `identifier` with the new `starts_with` operation, and the Console's Users list has a search field that uses it across every page. The match ignores case, is answered from an index, and returns the users ordered by identifier. A filter value containing a NUL byte or invalid UTF-8 now answers 400 on any text filter.
