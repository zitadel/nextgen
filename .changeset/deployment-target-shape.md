---
"@zitadel/server": minor
"@zitadel/cli": patch
---

The console shows the default target by name instead of as a broken link.

**Breaking:** a deployment's `targets` are now typed, `{ "type": "origin", "origin": "…" }` or `{ "type": "default" }`. The `rel.in_use` details list `targets` of `{ target, deployment_id }` instead of `origins`, and `GET /deployments` filters with `target` instead of `origin`.
