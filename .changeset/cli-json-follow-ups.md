---
"@zitadel/cli": patch
---

A `zitadel` command run with `--json` now suggests its follow-ups with `--json` too, in `next_commands` and in the argument lists of `next_args` and `details.suggested_args`, so an agent that runs one as given gets JSON back instead of terminal output. Other tools' commands, such as `npm run dev`, are suggested as before.
