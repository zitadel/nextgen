---
"@zitadel/server": patch
---

The bootstrap user import (`--user-file`) no longer fails a replica that starts while another replica imports the same document. A unique violation that left the user in place is read as "already imported", the same way the import already treats the project, team and schema rows it creates. Several replicas starting together, for example one function instance per request from cold, all start.
