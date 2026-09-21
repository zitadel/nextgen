---
---

Spanner migration DDL is now grouped into batched `UpdateDatabaseDdl` calls. The
code compiles into the server, but nothing ships: `spanner.Client.Migrate` is
build-tag gated (`spanner_integration`), which the release build does not set, so
the released binary cannot run Spanner migrations and never reaches this path.
The benefit lands on CI and local development only.
