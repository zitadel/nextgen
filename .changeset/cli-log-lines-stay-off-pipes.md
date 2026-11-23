---
"@zitadel/cli": patch
---

A line the CLI logs for a person, such as the wait for the browser step in `claim`, is no longer written to stdout when it is not a terminal, so a script reading a pipe is given only the command's result. `server console` and `env add` now carry their links and the file they wrote in that result.
