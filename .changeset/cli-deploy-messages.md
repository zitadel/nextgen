---
"@zitadel/cli": minor
---

`zitadel deploy` and `zitadel preview` record a message when `-m` is omitted: a GitHub pull request's title, Vercel's commit message, or the current commit's subject on a clean worktree, so a CI run no longer needs `-m`. `zitadel preview -m` and `zitadel deployment rollback -m` record a message of their own, and a blank or over-long `-m` is refused.
