---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /deployments` now deploys to preview URLs: an exact origin that matches one of the project's preview patterns. Each deployment creates or renews the preview of every URL with the `ttl`, seven days when omitted, always writes a new record, and each target in the response carries the expiry. An origin that is neither a primary origin nor matches a preview pattern answers `403` with `proj.origin_not_allowed`, and primary origins and preview URLs cannot be mixed. A `ttl` with primary origins answers `400` with `dep.invalid`.
