---
"@zitadel/server": minor
---

Add an opt-in service ping: with `service_ping.enabled` (`NEXTGEN_SERVICE_PING_ENABLED=true`), the server reports its version, database dialect and platform to Vercel Web Analytics when it starts and once a day after. It is off by default.
