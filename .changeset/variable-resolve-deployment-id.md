---
"@zitadel/cli": minor
"@zitadel/server": minor
---

`variable resolve` now takes an optional deployment id, so `zitadel variable resolve dep_...` shows the variables that deployment froze, live or not. Without it the command reads the live deployment as before. A deployment id together with `--origin` is refused, since the id already says which deployment to read.
