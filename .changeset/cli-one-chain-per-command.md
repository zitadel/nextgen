---
"@zitadel/cli": patch
---

Every command that talks to you now draws one chain from start to finish: a line saying what it is doing, the questions it asks, what it did, and one line saying how it ended. What to do next is one box of steps, laid out the same way in every command, with the commands to run on their own lines. Output stays within 80 columns, and `--json` and `--non-interactive` runs are unchanged.
