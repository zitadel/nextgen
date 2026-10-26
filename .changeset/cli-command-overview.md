---
"@zitadel/cli": minor
---

Running `zitadel` with no subcommand now lists the commands under six headings named for what you are doing (Getting started, Local development, Users and teams, Authentication, Configuration and releases, Diagnostics and utilities), with one row for each family of commands such as `users` or `release` instead of one row for every operation. `zitadel users --help` lists the operations, and the help of every command and family ends with the command that prints this overview. `zitadel setup` and `zitadel status` end with the same pointer, and several descriptions, including `deploy`, now say in plain words what the command does. `zitadel commands` still prints every command in one flat list.
