---
"@zitadel/server": minor
"@zitadel/cli": minor
---

`zitadel deployment list` and `zitadel deployment get` now show each deployment's kind and, for a preview, when it expires; `GET /deployments` returns the expiry as `targets[].expires_at`. See [Deploy](https://preview.zitadel.com/docs/guides/deploy). Previews made before this release show it only on the newest deployment to each URL.
