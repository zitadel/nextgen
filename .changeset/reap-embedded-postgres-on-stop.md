---
"@zitadel/cli": patch
---

`stop` now reaps the local server's embedded Postgres, and `start` self-heals a
Postgres orphaned by an earlier unclean exit. The server binary starts Postgres
through `pg_ctl`, which daemonizes the postmaster into its own session — so the
process-group signal `stop` sends never reached it, and a crash or SIGKILL could
leave it running and holding the data-directory lock. The next `start` then
failed with `E_NETWORK` ("exited before becoming healthy") and a `pg_ctl:
another server might be running` log. The CLI now terminates that postmaster by
its `postmaster.pid` (SIGINT fast-shutdown, escalating to SIGKILL) on every stop
and before every start, so `start → stop → start` is reliable again.
