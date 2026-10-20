---
"@zitadel/server": minor
---

`POST /deployments` deploys to preview URLs: targets that one of the project's preview patterns admits. Every such deployment writes a record and creates or renews the preview of each URL for `ttl`, seven days when omitted, and each target in the response carries the expiry. A URL no pattern admits answers `403` with `proj.origin_not_allowed`.
