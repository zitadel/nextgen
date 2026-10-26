---
"@zitadel/server": patch
---

The server now measures its database work: `db.client.operation.duration` times every storage statement, labelled with the database and the statement method that issued it, and `db.client.connection.count` and `db.client.connection.max` report the PostgreSQL and SQLite connection pools by state. Both are listed in the configuration guide's Metrics section.
