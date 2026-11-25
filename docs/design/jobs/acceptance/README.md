# Background jobs — Gherkin acceptance suite

Executable-spec style scenarios for the jobs runtime. They are the behavior
contract implementers must satisfy. Go tests in slices 1–4 already mirror many
scenario titles (`stmttest`, `internal/jobs`, `sessions_gc*`, `trigger_test`);
optional godog can bind these files later.

Landed by Slice **G** of the MVP stack with MVP-accurate wording for the
schema split (`jobs` + `job_schedules`) and Engine/Cron wake modes. Decision record:
[ADR 065](../../../adrs/065-background-jobs.md). Design note:
[runtime.md](../runtime.md).

| File | Layer | Primary slice | Go home (today) |
|------|--------|----------------|-----------------|
| [job-statements.feature](./job-statements.feature) | `JobStatements` + dialects | Slice 1 | `apps/api/internal/storage/stmttest/jobs_test.go` |
| [engine.feature](./engine.feature) | `jobs.Engine` | Slice 2 | `apps/api/internal/jobs/engine_test.go` |
| [sessions-gc.feature](./sessions-gc.feature) | First consumer `#881` | Slice 3 | `sessions_gc*_test.go` + stmttest reaper |
| [cron-wake.feature](./cron-wake.feature) | Serverless Cron → drain | Slice 4 | `apps/api/internal/jobs/trigger_test.go` |

## Automation mapping

| Tag | Intended home |
|-----|----------------|
| `@stmttest` | `apps/api/internal/storage/stmttest` via `forEachDialect` |
| `@engine` | `apps/api/internal/jobs` unit/integration (fake statements or sqlite) |
| `@sessions-gc` | Handler + server wiring integration |
| `@cron` | HTTP trigger + cloud-shaped drain tests |
| `@dialect-parity` | Must pass on postgres, spanner, and sqlite |
| `@mvp-coexistence` | Negative/coexistence checks that prove post-MVP work has **not** shipped yet |
| `@post-mvp` / `@deferred` | Named follow-up; not part of MVP acceptance. Pair with `@slice5`–`@slice7` |

Repo has no Cucumber/godog runner today. Prefer: keep these `.feature` files as
the spec, implement as table-driven / stmttest Go that mirrors scenario titles
(or adopt godog in a follow-up). Do not invent a second conflicting prose checklist.

## Vocabulary

- **Wake** — what starts work: self-hosted `Start()` poll, or Cron HTTP `drain` /
  `RunDueOnce` at `/cron/jobs`.
- **Take / Perform / Complete / Fail / Heartbeat** — ownership protocol (ADR 065).
- **lease_token** — fencing token from Take; required on Heartbeat/Complete/Fail.
- **Periodic** — schedule via `SetPeriodic` (`job_schedules`); Complete/Fail only
  advances `run_at`. Schedules have **no** `status`, **no** `unique_key`, and are
  never `pending` / `done` / `dead`. Take returns `TakeResult.Schedule`.
- **Queued** — `Enqueue` in a product tx (`jobs` table). Status and `unique_key`
  apply only here. Take returns `TakeResult.Job`.
- **Defaults** — lease **30s**, heartbeat **10s** (`jobs.DefaultConfig`).

## Out of scope for MVP (tagged `@post-mvp` where named)

- `jobs.gc` periodic cleaner that wires `DeleteCompleted` (Slice 5; statement exists).
- Retention cutover onto jobs (still on `RetentionJob` / `/cron/events-retention`; Slice 6).
- Operator CLI/API `SetPeriodic` (boot/config only in v1; Slice 7).
- Spanner wake queues, per-name fairness, `email.send` delivery.
