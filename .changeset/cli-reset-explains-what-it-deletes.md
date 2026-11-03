---
"@zitadel/cli": patch
---

`zitadel reset` now says what it deletes before it asks: the local server's database in `.zitadel/local/nextgen-data`, which cannot be undone, and that it keeps the local admin sign-in and the rest of the project. `reset --dry-run --json` and a real `reset --json` now return that scope in `data.scope` (`deletes` and `keeps`, as absolute paths), and the "Cannot delete … without --force" refusal now reads "Cannot delete the local Zitadel server's data in \"<directory>\" without --force".
