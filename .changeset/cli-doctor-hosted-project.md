---
"@zitadel/cli": patch
---

`zitadel doctor` no longer checks a local Zitadel runtime for a project set up against a hosted server, so another app on port 8080 no longer fails it with `E_PORT_IN_USE`.
