---
"@zitadel/cli": patch
"@zitadel/server": patch
---

`deployment get`, `deployment rollback`, `deployment create --release`, `release revoke`, and the generated `users`, `sessions` and `release` commands that take an id, now refuse a value that is not the kind of id they take, such as a release id given to `deployment rollback`, before they ask for confirmation or call the server. Surrounding whitespace around an id is trimmed, including for `claim --challenge-id`, and a value that is not a valid id is refused with a message saying what one looks like.
