# Agent Instructions — `internal/jobs/`

Shared `jobs.Engine` above `service.JobStatements` (ADR 065).

- Dialects never `RegisterWorker`. Engine owns the handler map, poll /
  `RunDueOnce`, and Take / Heartbeat / Complete / Fail transactions.
- Product handlers (e.g. `sessions.gc` in `internal/service`) and server /
  Cron wiring live outside this package.
- Cron drain: `Engine.Trigger()` at `/cron/jobs` when `jobs.trigger_secret`
  is set (same bearer rules as retention). Self-hosted without the secret
  uses `Start()` poll.
- Guide: [`docs/design/jobs/`](../../../../docs/design/jobs/README.md).
  Acceptance: [`docs/design/jobs/acceptance/engine.feature`](../../../../docs/design/jobs/acceptance/engine.feature),
  [`sessions-gc.feature`](../../../../docs/design/jobs/acceptance/sessions-gc.feature),
  [`cron-wake.feature`](../../../../docs/design/jobs/acceptance/cron-wake.feature).
