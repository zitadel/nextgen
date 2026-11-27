# Background jobs — Gherkin acceptance

Executable-spec scenarios for the jobs runtime (ADR 065). They are the behavior
contract; Go tests in slices 1–4 already mirror many scenario titles. There is
**no** Cucumber/godog runner in CI today — treat these files as the checklist
and keep stmttest / `internal/jobs` / sessions.gc / trigger tests aligned.

Canonical home: `e2e/acceptance/background-jobs/` (moved from
`docs/design/jobs/acceptance/`).

Decision record: [ADR 065](../../../docs/adrs/065-background-jobs.md).
Design note: [runtime.md](../../../docs/design/jobs/runtime.md) (Slice D+).

## Features

| File | Layer | Primary slice | Go home (today) |
|------|--------|----------------|-----------------|
| [job-statements.feature](./job-statements.feature) | `JobStatements` + dialects | Slice 1 | `apps/api/internal/storage/stmttest/jobs_test.go` |
| [engine.feature](./engine.feature) | `jobs.Engine` | Slice 2 | `apps/api/internal/jobs/engine_test.go` |
| [sessions-gc.feature](./sessions-gc.feature) | First consumer `#881` | Slice 3 | `sessions_gc*_test.go` + stmttest reaper |
| [cron-wake.feature](./cron-wake.feature) | Serverless Cron → drain | Slice 4 | `apps/api/internal/jobs/trigger_test.go` |

## How to “run”

1. Read the `.feature` for the slice you are changing.
2. Run the Go home listed above (dialect tags for stmttest: `sqlite_integration`,
   `postgres_integration`, `spanner_integration`).
3. Optional later: bind these files with godog — do not invent a second prose checklist.

```bash
# examples from apps/api
go test ./internal/jobs/ -count=1
go test ./internal/service/ -run SessionsGC -count=1
go test -tags sqlite_integration ./internal/storage/stmttest/ -run 'JobStatements|SessionsGC|DeleteSessions' -count=1
```

## Tags

| Tag | Meaning |
|-----|---------|
| `@stmttest` / `@dialect-parity` | Portable statements; three dialects |
| `@engine` | `jobs.Engine` unit/integration |
| `@sessions-gc` / `@cron` | Product handler / HTTP drain |
| `@mvp-coexistence` | Proves post-MVP work has **not** shipped yet |
| `@post-mvp` / `@deferred` | Follow-up only (`@slice5`–`@slice7`) — not MVP gate |

## MVP vs post-MVP

**MVP (slices 1–4):** Enqueue / SetPeriodic / Take allowlist / fencing;
`jobs.Engine` poll + `RunDueOnce`; `sessions.gc` filter-delete + Path B
`session.expired`; `/cron/jobs` drain when `jobs.trigger_secret` is set.

**Out of MVP** (tagged `@post-mvp` in the features): `jobs.gc` cleaner wiring,
retention cutover onto Engine, operator CLI/API `SetPeriodic`.

## Results

Dated verification notes live under [`results/`](./results/).
