---
title: /readyz waits for the database, and /healthz is gone
summary: /readyz answers 503 while the server's database does not answer within a second, so a load balancer stops sending it requests. /healthz is removed.
date: 2026-10-25T00:43Z
cloud: true
pulls: [2308]
---

`/readyz` now answers `503` while the server's database does not answer within a second, so a load balancer stops sending it requests, and the console's System screen reads it. `/livez` still answers while the process serves HTTP: point liveness probes there, so a database outage does not restart every instance.

From 0.2.0, `zitadel start` waits until the local server's database answers, `zitadel doctor`, `status` and `setup` count a local server as healthy only then, and `withZitadel` from `@zitadel/testing` waits for `/readyz` as well.

**Breaking:** `/healthz` is removed. Move liveness probes that use it to `/livez`, and readiness probes to `/readyz`. A `zitadel` CLI or `@zitadel/testing` from an earlier release waits for `/healthz`, so it does not see a server from this release as up: update them together with the server.
