---
"@zitadel/cli": minor
---

`zitadel deploy` and `zitadel preview` record the current commit's subject as the release and deployment message when `-m` is omitted, so a CI run no longer needs `-m`. `zitadel preview -m` and `zitadel deployment rollback -m` record a message of their own.
