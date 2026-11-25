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
  Acceptance: [`e2e/acceptance/background-jobs/`](../../../../e2e/acceptance/background-jobs/README.md)
  ([engine](../../../../e2e/acceptance/background-jobs/engine.feature),
  [sessions-gc](../../../../e2e/acceptance/background-jobs/sessions-gc.feature),
  [cron-wake](../../../../e2e/acceptance/background-jobs/cron-wake.feature)).
