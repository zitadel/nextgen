---
"@zitadel/server": minor
"@zitadel/api": minor
---

A deployment to preview URLs keeps each preview live for the `ttl` it sends, counted from the deployment, and for 7 days when it sends none. `ttl` is an ISO-8601 duration such as `P7D` or `PT1H`, like the session exchange's `ttl`; a `ttl` above 365 days answers `400` with `dep.invalid` and writes nothing. A session exchange `ttl` too large to represent now answers `400` instead of wrapping around.
