---
"@zitadel/cli": patch
---

A refusal that named a command in its hint, such as a login flow still using a method, the last way to sign in, or `--input -` or `--file -` with nothing piped in, now lists it under `next_commands` too, so it carries the `--cwd`, `--env`, `--env-file` and `--server` the run was given.
