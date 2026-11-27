---
"@zitadel/cli": patch
---

The CLI's libraries throw typed errors of their own and the commands that call them catch each one by class. Some failure messages now carry their facts inline, and the `--json` envelope of those failures no longer has a `details` object.
