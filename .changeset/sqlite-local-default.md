---
"@zitadel/server": minor
---

Use SQLite (modernc.org/sqlite, no CGO) as the zero-config local database instead of embedded Postgres. Persist at `<server.data_dir>/zitadel.db`; override with `database.sqlite:`.
