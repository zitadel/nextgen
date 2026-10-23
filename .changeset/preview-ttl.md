---
"@zitadel/server": minor
"@zitadel/api": minor
---

A deployment to preview URLs keeps each preview live for the `ttl` it sends, counted from the deployment, and for 7 days when it sends none. A `ttl` above 365 days answers `400` with `dep.invalid` and writes nothing.
