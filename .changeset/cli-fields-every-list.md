---
"@zitadel/cli": minor
---

Every command that prints a list or a record takes `--fields`, and it cuts the records under `--json` as well as the table: `user list --fields id,email --json` and `variable get NAME --fields value --json` return only those paths, and a field the command does not carry is refused with the ones it does.

**Breaking:** `--json` ignored `--fields` before, so a script that passed it and read the whole record must stop passing it.
