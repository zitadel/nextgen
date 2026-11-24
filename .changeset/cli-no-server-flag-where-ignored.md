---
"@zitadel/cli": minor
---

`--server` is taken only by a command that reads a server, and the commands those suggest next no longer carry it.

**Breaking:** `start`, `stop`, `reset`, `logs`, `tests add`, `skills add`, `upgrade`, `eject` and `branding eject` never used `--server` and now refuse it as an unknown flag. Remove it from scripts that pass it to them.
