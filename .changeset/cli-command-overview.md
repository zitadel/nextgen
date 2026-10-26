---
"@zitadel/cli": minor
---

Running `zitadel` with no subcommand now lists the commands under six headings named for what you are doing, with one row for each family of commands such as `users` or `release` instead of one for every operation. `zitadel users --help` lists the operations, the help of every command ends with the command that prints the overview, and `zitadel setup` and `zitadel status` end with the same pointer. `zitadel commands` still prints every command in one flat list.
