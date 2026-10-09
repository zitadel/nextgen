---
"@zitadel/cli": patch
"@zitadel/server": patch
---

The Zitadel server container now starts as the non-root user it ships with. It previously created a data directory next to its own entrypoint before reading configuration, which is not writable by that user, so the container exited before serving — and setting a data directory via environment or config file did not avoid it. This also fixes `zitadel start --runtime docker`, which failed the same way.
