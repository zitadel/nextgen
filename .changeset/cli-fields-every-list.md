---
"@zitadel/cli": minor
---

Every command that prints a list takes `--fields`, and `--fields` cuts the records under `--json` as well as the table: `user list --fields id,email --json` returns only those paths. A field a list does not carry is refused with the ones it does. `get` cuts its record the same way, and `api ls` judges `--fields` by the shape of an operation. Breaking: `--json` was unaffected by `--fields` before.
