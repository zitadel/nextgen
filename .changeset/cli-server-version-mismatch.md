---
"@zitadel/cli": patch
---

When the server has no endpoint for a command, the CLI now says that the server and the CLI are different versions instead of reporting a missing resource, and still tells apart a `--server` that is not a Zitadel API.
