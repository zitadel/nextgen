---
"@zitadel/cli": minor
---

`variable get`, `invitation get`, a resource's `get`, and a created or updated resource print the same plain text off a terminal as on one, and `--json` is the one way to get JSON.

**Breaking:** these commands printed JSON when stdout was not a terminal, so a script that parsed it without `--json` must now pass `--json`.
