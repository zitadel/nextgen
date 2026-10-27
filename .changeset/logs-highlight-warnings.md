---
"@zitadel/cli": minor
---

`zitadel logs` now shows the local server's warnings in yellow and errors in red, and `--level warn` shows only those, so the reason a sign-in failed is easy to find. `zitadel start` and `zitadel doctor` say to keep `zitadel logs --follow` open, and `zitadel logs` works from an app inside the directory `zitadel start` ran in.
