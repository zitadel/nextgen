---
"@zitadel/cli": patch
---

A configuration that holds a client secret as a value now answers with the `variable set` command to publish it under `next_commands`, where the hint used to carry the command inside its sentence, so the command is rendered with the environment the deploy addressed like every other suggestion.
