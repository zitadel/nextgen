---
"@zitadel/cli": patch
---

`zitadel setup --cwd <dir>` creates `<dir>` when it does not exist yet, instead of failing with a raw `ENOENT` error, and removes it again if setup does not finish. A `--cwd` that is a file now fails with a clear message.
