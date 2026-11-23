---
"@zitadel/cli": patch
---

A line that only says what the CLI is working on, such as the wait for the browser step in `claim` or the deploy to a new environment in `env add`, is no longer written to stdout when it is not a terminal, so a script reading a pipe is given only the answer.
