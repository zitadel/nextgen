---
"@zitadel/server": minor
---

`server.lifecycle` (`NEXTGEN_SERVER_LIFECYCLE`) tells the server how its platform keeps the process running: `always_on` (the default), `scale_to_zero` (Knative) or `request_only` (a Vercel function, Cloud Run by default). It refuses to start with background work it could not run there. Where no timer runs, a scheduler's call to `/cron/wake-up` with `server.wake_up.secret` runs the periodic work ([Where the server runs](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#where-the-server-runs)).

**Breaking:** `events.retention.trigger_secret` and `/cron/events-retention` are gone. Set `server.wake_up.secret` (`NEXTGEN_SERVER_WAKE_UP_SECRET`) to the secret and point the scheduler at `/cron/wake-up`, which also runs the audit event export when it is on. It answers `{"tasks":[{"name":"event_retention","ok":true}]}` instead of `{"deleted":42}`; the count is in the server's log. The secret no longer stops an `always_on` server's own purge timer.
