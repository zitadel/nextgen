---
"@zitadel/server": patch
"@zitadel/cli": patch
---

`zitadel claim` now stops with a clear explanation when the server has no platform project to claim into — a plain local `zitadel start` runtime by default — instead of opening a claim page that cannot sign you in. The server answers `claim/init` with `501 claim.no_platform_project` on such deployments, and the CLI hint says how to enable the platform project locally or to claim on Zitadel Cloud.
