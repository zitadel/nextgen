---
"@zitadel/cli": minor
---

`zitadel deploy`, `deployment create`, `env add`'s initial deploy and `setup`'s deploy land on every primary origin and on the `default` target, which a caller with no `Origin` is served. `deployment rollback` guards against the newest deployment to the targets it writes, so a newer deployment to `default` alone no longer makes it fail with a conflict.
