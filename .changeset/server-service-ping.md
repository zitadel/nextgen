---
"@zitadel/server": minor
---

Add an opt-in service ping: with `service_ping.enabled` (`NEXTGEN_SERVICE_PING_ENABLED=true`), the server reports its version, whether it runs self-hosted or locally (on a loopback `server.public_base`), its database dialect, operating system and CPU architecture to Vercel Web Analytics when it starts and once a day after. It never sends its address. It is off by default.
