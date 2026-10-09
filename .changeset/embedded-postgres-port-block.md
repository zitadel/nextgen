---
"@zitadel/server": patch
---

Pick the embedded Postgres port from a fixed block below the OS ephemeral range so concurrent processes' outbound connections can no longer steal it between allocation and the postmaster bind, which made `zitadel start` fail with "Local Zitadel server process exited before becoming healthy" under parallel load.
