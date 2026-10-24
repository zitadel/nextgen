---
"@zitadel/server": patch
---

`/readyz` now checks that the server's database answers, within a second, and answers `503` with `fail` while it does not, so a load balancer or orchestrator stops sending requests to a server that cannot serve them. `/livez` still answers as long as the process serves HTTP; point liveness probes there, so that a database outage does not restart every instance. `/healthz` answers as `/livez` does and now carries a `Deprecation` header: it keeps working until 1.0.0, so move probes that use it to `/livez` or `/readyz`. The console's System screen now reads `/readyz`, so it reports the server as unhealthy when its database does not answer.
