---
"@zitadel/server": patch
---

Serialize concurrent schema migrations sharing one database: Postgres takes a session advisory lock and Spanner claims a lease row, so several server nodes (or parallel test packages) starting at once migrate exactly once instead of racing goose's DDL.
