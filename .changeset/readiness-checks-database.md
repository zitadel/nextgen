---
"@zitadel/server": minor
---

`/readyz` now checks that the server's database answers, within a second, and answers `503` with `fail` while it does not, so a load balancer or orchestrator stops sending requests to a server that cannot serve them. `/livez` still answers as long as the process serves HTTP; point liveness probes there, so that a database outage does not restart every instance. The console's System screen now reads `/readyz`, so it reports the server as unhealthy when its database does not answer.

**Breaking:** `/healthz` is removed. Move liveness probes that use it to `/livez`, and readiness probes to `/readyz`. A `zitadel` CLI or `@zitadel/testing` from an earlier release waits for `/healthz`, so it does not see a server from this release as up: update them together with the server.
