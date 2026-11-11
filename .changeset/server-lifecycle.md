---
"@zitadel/server": minor
---

`server.lifecycle` (`NEXTGEN_SERVER_LIFECYCLE`) tells the server how its platform keeps the process running: `always_on` (the default), `scale_to_zero` where the last instance is stopped when no request comes, as on Knative, or `request_only` where the process is paused between requests, as a Vercel function is, or Cloud Run by default. With `request_only`, `events.request.flush_wait` defaults to `2s` and `server.idle_timeout` to `0`, a master key rotation re-wraps before the first request, and the server refuses to start with background work it could not run: event retention without `events.retention.trigger_secret`, and `events.export.enabled`. `service_ping.enabled` fails the start with `scale_to_zero` and `request_only`.
