# Agent Instructions — `internal/jobs/`

Shared `jobs.Engine` above `service.JobStatements` (ADR 065).

- Dialects never `RegisterWorker`. Engine owns the handler map, poll /
  `RunDueOnce`, and Take / Heartbeat / Complete / Fail transactions.
- Product handlers (e.g. `sessions.gc`) and server / Cron wiring live outside
  this package.
- Guide: [`docs/design/jobs/`](../../../../docs/design/jobs/README.md).
  Acceptance: [`docs/design/jobs/acceptance/engine.feature`](../../../../docs/design/jobs/acceptance/engine.feature).
