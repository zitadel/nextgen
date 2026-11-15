---
"@zitadel/cli": minor
"@zitadel/config": patch
---

Every `zitadel` resource command names its resource in the singular, as
`zitadel release`, `zitadel deployment` and `zitadel variable` already did:
`zitadel user list`, `zitadel policy test`
([CLI reference](https://preview.zitadel.com/docs/reference/cli)). The plural
of every noun still runs the same command, so `zitadel users list` keeps
working; help, completion and the reference show only the singular.

**Breaking:** nothing you type stops running, but what the CLI prints names
the singular whichever spelling you typed. With `--json`, the envelope's
`command` is `user:list` where it was `users:list`, and the `topic` that
`zitadel resources` and a `--dry-run` report is `user`, for `users`, `teams`,
`sessions`, `events`, `grants`, `idps`, `projects`, `schemas`, `policies` and
`flow-definitions` alike. `zitadel commands` lists the singular ids only. A
script that compares one of those values needs the new name. A plural typed
alone, such as `zitadel users`, no longer prints that topic's help: it fails
as an unknown command and names `zitadel user --help` as its next command.
