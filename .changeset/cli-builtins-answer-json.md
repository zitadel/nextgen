---
"@zitadel/cli": minor
---

`version`, `commands`, `which`, `help` and `autocomplete` answer `--json` with the same envelope as every other command, and a flag they refuse is the failure envelope with its exit code instead of oclif's whole error object. They still take their own flags (`commands --hidden`, `--tree`, `--columns`, `help --nested-commands`, `autocomplete --refresh-cache`).

**Breaking:** `version --json` and `commands --json` print their result as the envelope's `data`, and `commands --json` holds its list under `data.result`.
