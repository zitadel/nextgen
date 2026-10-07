---
"@zitadel/server": patch
---

Traced requests now show each database statement as its own span, so a slow
request points at the statement that took the time. On PostgreSQL, running a
query and waiting for a pool connection get their own spans too.
