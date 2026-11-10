---
"@zitadel/cli": patch
"@zitadel/server": patch
---

`deployment get`, `deployment rollback`, `deployment create --release` and `release revoke` now refuse a value that is not the kind of id they take, such as a release id given to `deployment rollback`, before they ask for confirmation or call the server.
