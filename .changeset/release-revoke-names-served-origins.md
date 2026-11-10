---
"@zitadel/cli": patch
---

`release revoke` on a release an origin still serves now names the first three origins and the deployment that pins the release there, counting the rest, and suggests `zitadel deploy` or `zitadel deployment rollback` to move off it before revoking again. With `--json`, the same origins are in `details.origins`.
