---
"@zitadel/cli": patch
---

`zitadel api ls` now takes `--plain`, and every list command (`origin list`, `deployment list`, `preview list`, `variable list`, `variable resolve`, `env list`, `resources` and the generated `<resource> list` commands) prints its terminal table, its piped rows and its next-page hint the same way. `variable resolve` now shows its count as `N variables` with the deployment it was frozen by on the line below.
