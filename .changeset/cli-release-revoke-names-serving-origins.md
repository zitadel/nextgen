---
"@zitadel/cli": patch
---

`zitadel release revoke` on a release an origin still serves now names each origin that serves it, with its kind and the deployment that pins it, and suggests what frees it: `deploy` or `deployment rollback` for a primary origin, `preview rm` for a preview. It used to say only that an origin still serves the release.
