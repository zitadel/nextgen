---
"@zitadel/server": minor
---

Add the shared `jobs.Engine` (RegisterWorker, Start/Close poll, RunDueOnce) above JobStatements, with zlog debug tracing of take/perform/heartbeat/complete/fail including the lease token.
