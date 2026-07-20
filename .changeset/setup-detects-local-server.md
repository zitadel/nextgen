---
"@zitadel/cli": patch
---

The interactive `setup` wizard now detects a running local Zitadel server the
same way `start` and `doctor` do — via the runtime metadata written by
`zitadel start` plus a `/healthz` probe on the default port — and preselects
it in the server choice. Previously it scanned localhost ports for an OIDC
discovery document the server does not serve, so it always reported "No local
OIDC servers found" even with a healthy server running.
