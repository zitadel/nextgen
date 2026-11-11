---
"@zitadel/cli": patch
---

Every command that answers a question does so in the same words. A list that finds nothing says `No <things> found.`, and counts use the resource's own plural. `zitadel api ls`, `deployment get`, `release create`, `deployment create` and `env` end like every other command, and a piped `deployment get` prints the record. Every confirmation now names the project and the server it acts on, for example `Remove FOO from project proj_1 on api.zitadel.cloud?`. The first release `setup` creates is recorded as "Initial deployment from setup" and `env add`'s as "Initial deployment from env add", and the commit `setup` makes now reads "…with Zitadel setup".
