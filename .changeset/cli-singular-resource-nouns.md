---
"@zitadel/cli": minor
"@zitadel/config": patch
---

Every `zitadel` resource command names its resource in the singular, as
`zitadel release`, `zitadel deployment` and `zitadel variable` already did:
`zitadel user list`, `zitadel policy test`
([CLI reference](https://preview.zitadel.com/docs/reference/cli)).

**Breaking:** the plural commands are gone, with no alias. `users`, `teams`,
`sessions`, `events`, `grants`, `idps`, `projects`, `schemas`, `policies` and
`flow-definitions` are `user`, `team`, `session`, `event`, `grant`, `idp`,
`project`, `schema`, `policy` and `flow-definition`. Verbs, arguments and
flags are unchanged, and `branding` keeps its name. Rename the calls in your
scripts and CI: `zitadel users list` is `zitadel user list`, and
`zitadel policies test` is `zitadel policy test`. With `--json`, the
envelope's `command` (`user:list`) and the `topic` that `zitadel resources`
and a `--dry-run` report change with them. A plural typed out of habit
fails as any unknown command does and names the singular command's help as
its next command (`zitadel policies list` names `zitadel policy --help`). The
old CLI reference pages redirect, and `zitadel --help` lists the current
names.
