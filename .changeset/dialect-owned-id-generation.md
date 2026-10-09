---
"@zitadel/server": minor
---

Server assigns every resource primary key in storage dialects as a prefixed opaque string (Postgres/SQLite ULID, Spanner UUID v4); SQL no longer uses IDENTITY defaults, and create APIs do not accept client primary keys.
