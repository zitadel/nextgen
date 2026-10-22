---
"@zitadel/cli": minor
---

`zitadel logs` now shows the local server's warnings in yellow and its errors in red on a terminal, and `zitadel logs --level warn` shows only those, so the reason a sign-in failed, such as a sign-in provider the server could not reach, is easy to find. `--tail` counts only the lines `--level` shows. `zitadel start`, and `zitadel doctor` when the local server is running, now say to keep `zitadel logs --follow` open, and `zitadel logs` works from an app inside the directory `zitadel start` ran in.
