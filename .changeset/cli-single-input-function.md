---
"@zitadel/cli": patch
---

Every question the CLI asks now goes through one input function, so a missing value, a missing `--force` and a cancelled prompt read the same in every command. A command that cannot ask now says "No <value> supplied" with a hint naming the flag to pass or the stdin to pipe, a destructive command without `--force` says it cannot proceed without it, and Ctrl-C at any prompt reports "Cancelled by user" instead of naming the command. Cancelling the confirmation of `variables delete` or a resource `delete` now stops with that error instead of reporting a skipped delete.
