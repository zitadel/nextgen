---
"@zitadel/cli": patch
---

Every command that talks to you now draws one chain from start to finish: a line saying what it is doing, the questions it asks, what it did, and one line saying how it ended. What to do next is one box of steps, laid out the same way in every command, with the commands to run on their own lines. A run that changed nothing, such as a declined confirmation or one with nothing left to do, says what it left in place and the command that moves it on, instead of the reason the envelope carries. Output stays within 80 columns, and `--json` runs are unchanged. `zitadel setup` joins them: its steps sit in the chain, its dependency install is a step like any other, and the report it ends on is the same box whether or not anyone is at a terminal.
