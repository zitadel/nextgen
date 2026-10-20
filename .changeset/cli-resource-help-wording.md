---
"@zitadel/cli": patch
---

`zitadel idps create --help` now suggests `--file ./identity-provider-connection.json`,
an example you can run as written: the file name it showed before had spaces in
it, so a shell split it into three arguments. The help for `zitadel users create`,
`users update` and `users delete` now says "a user" instead of "an user".
