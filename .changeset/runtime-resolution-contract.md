---
"@zitadel/server": minor
---

Runtime operations document how a request finds its release from the browser `Origin` header. `POST /flow` takes `Origin` as the input that selects the deployment; an origin that matches no project pattern answers `403` with `proj.origin_not_allowed`, a preview URL with no live preview answers `403` with `proj.preview_not_live`, nothing deployed answers `409` with `rel.not_deployed`, and a revoked release answers `409` with `rel.revoked`. Later flow steps and app-plane auth-attempt operations re-use the sealed deployment and only refuse with `rel.revoked` (plus `proj.mismatch` / `rel.not_deployed` on create and handoff exchange). The server still serves today's behavior until the resolution path lands.
