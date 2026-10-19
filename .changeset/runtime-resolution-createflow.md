---
"@zitadel/server": minor
---

`POST /flow` resolves the release from the browser `Origin` header: the gate admits the origin against the project's patterns and live previews, the newest deployment to that exact origin is the target, and that deployment's release is sealed into `_zflow` as `deployment_id` and `release_id`. An origin that matches no pattern answers `403` with `proj.origin_not_allowed`, a preview URL with no live preview answers `403` with `proj.preview_not_live`, nothing deployed answers `409` with `rel.not_deployed`, and a revoked release answers `409` with `rel.revoked`. A request with no `Origin` keeps the previous newest-revision path until the project default target lands.
