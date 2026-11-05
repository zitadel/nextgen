---
"@zitadel/api": minor
"@zitadel/cli": patch
---

`createZitadelClient` now takes a `userAgent`, which it sends on every request it makes. The CLI sets its own `User-Agent` through that option instead of replacing the process-wide undici dispatcher, so a request made by anything else in the process keeps the agent it chose.
