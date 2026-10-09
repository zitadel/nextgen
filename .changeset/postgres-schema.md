---
"@zitadel/server": minor
---

The Postgres dialect can run in a schema of your choice. Add
`?schema=<schema>` to `NEXTGEN_DATABASE_POSTGRES` (a parameter the server
consumes and never sends to the database, so it works through PgBouncer),
set `schema:` beside the map-form connection settings, or name the schema
first in `search_path`, and every table, type and the migration history
lands in that schema instead of `zitadel_nextgen`. Several instances
can share one database that way, and a throwaway environment is removed with
a single `DROP SCHEMA … CASCADE`. The extensions Zitadel needs (`pgcrypto`,
`btree_gin`) are installed once per database into `public` and shared by all
schemas, and each schema takes its own migration lock, so several schemas
of one database can migrate at the same time.
