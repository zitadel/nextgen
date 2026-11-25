# Background jobs

Portable SQL-backed background work for Zitadel nextgen: periodic sweeps and
queued jobs on PostgreSQL, Spanner, and SQLite.

| Doc | What it is |
|-----|------------|
| [runtime.md](./runtime.md) | Engine vs statements, wake modes, recipes, config |
| [acceptance/](./acceptance/README.md) | Gherkin behavior contract |
| [ADR 065](../../adrs/065-background-jobs.md) | Decision record (Proposed) |

**First product handler:** `sessions.gc` ([#881](https://github.com/zitadel/nextgen/issues/881)).
Event retention stays on `RetentionJob` / `/cron/events-retention` until a
later cutover.
