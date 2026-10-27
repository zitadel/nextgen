---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /deployments` now deploys a release to the preview URLs named in `targets`, each matching one of the project's preview patterns, and keeps each live for the request's `ttl`, an ISO-8601 duration of up to 365 days, or for 7 days ([docs](https://preview.zitadel.com/docs/reference/api/deployments/createDeployment)). A session exchange `ttl` too large to represent now answers `400` instead of wrapping around.
