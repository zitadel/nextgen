---
"@zitadel/server": minor
---

Operators can run `nextgen migrate` to apply schema changes and exit without starting the HTTP server. `server` no longer migrates on start unless you pass `--migrate`; `zitadel start` and the published image still migrate.
