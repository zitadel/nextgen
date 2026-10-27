---
"@zitadel/server": minor
---

`/readyz` now answers `503` while the server's database does not answer within a second, so a load balancer stops sending it requests, and the console's System screen reads it. `/livez` still answers while the process serves HTTP; point liveness probes there, so a database outage does not restart every instance.

**Breaking:** `/healthz` is removed. Move liveness probes that use it to `/livez`, and readiness probes to `/readyz`. A `zitadel` CLI or `@zitadel/testing` from an earlier release waits for `/healthz`, so it does not see a server from this release as up: update them together with the server.
