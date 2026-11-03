---
"@zitadel/cli": patch
---

`zitadel claim` now waits on its normal, growing delay after the platform rate-limits a status check, and the browser is opened through the `open` package, which takes a `BROWSER` setting as the program to open the link with.
