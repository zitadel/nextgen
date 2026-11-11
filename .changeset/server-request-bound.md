---
"@zitadel/server": minor
---

`server.request_bound` (`NEXTGEN_SERVER_REQUEST_BOUND`) tells the server that its process runs only while it serves a request, as a Vercel function does, or a Cloud Run service with CPU allocated only during requests. `events.request.flush_wait` then defaults to `2s` and `server.idle_timeout` to `0`, a master key rotation re-wraps before the first request, and the server refuses to start with background work it could not run there: event retention without `events.retention.trigger_secret`, `events.export.enabled` and `service_ping.enabled`.
