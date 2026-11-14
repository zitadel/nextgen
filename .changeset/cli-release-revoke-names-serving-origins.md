---
"@zitadel/cli": minor
---

`zitadel release revoke` on a release an origin still serves now names the first three origins that serve it, each with its kind and deployment, and counts the rest. It suggests `deploy` or `deployment rollback` for a primary origin and `preview rm` for the first three previews.

**Breaking:** with `--json`, the refusal's `details` is now `{ release_id, origins }`, listing every serving origin as `{ origin, deployment_id, kind }`, instead of the server's `status`, `url` and `body`. Read the origins from `details.origins` instead of `details.body.details.origins`.
