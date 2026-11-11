---
"@zitadel/cli": minor
---

Every failure reads `Error: <sentence> (E_CODE)`, with the hint under it and the commands to run next under `Next:`. A refused command line is answered in the CLI's own words, with its help offered under `Next:`, and cancelling says one word, `Cancelled`, everywhere. A failing command also says which project and server it failed against.

**Breaking:** the code moved from the front of the failure line to the end, so anything that reads stderr for `Error E_…:` must read `Error: … (E_…)`. `--json` and the exit codes keep their shape.
