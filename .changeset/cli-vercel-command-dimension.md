---
"@zitadel/cli": minor
---

The usage analytics events the CLI sends to Vercel Web Analytics now carry one property of the command's own for `setup` (`framework`), `claim` (`claim_outcome`), `doctor` (`failed_checks`), `api` (`operation`) and `start` (`runtime`). On a failed run it takes the place of `non_interactive`. The kind of data sent does not change: fixed names only, never a path, id or message.
