---
"@zitadel/cli": minor
---

A single record is JSON only with `--json`. `variable get`, `invitation get`, a resource's `get`, and a created or updated resource used to print JSON when stdout was not a terminal, so a script got a different shape with and without `--json`. Off a terminal they now print the same plain text as on one, without colour, and `--json` is the one way to get JSON.
