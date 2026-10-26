---
"@zitadel/server": minor
---

`POST /deployments` now deploys a release to preview URLs. Name each URL in `targets`; it must match one of the project's preview patterns, or the request answers `403` with `proj.origin_not_allowed`, and a loopback URL is never a preview. Every such deployment writes a new record and keeps the preview of each URL live for 7 days from that deployment; a `ttl` in the request is accepted, but the 7 days apply for now.
