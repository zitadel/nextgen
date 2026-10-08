---
"@zitadel/server": minor
---

The Postgres dialect can run in a schema of your choice. Add
`?search_path=<schema>` to `NEXTGEN_DATABASE_POSTGRES` (or set `schema:`
beside the connection settings) and every table, type and the migration
history lands in that schema instead of `zitadel_nextgen`. Several instances
can share one database that way, and a throwaway environment is removed with
a single `DROP SCHEMA … CASCADE`. The extensions Zitadel needs (`pgcrypto`,
`btree_gin`) are installed once per database into `public` and shared by all
schemas.
