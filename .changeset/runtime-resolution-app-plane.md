---
"@zitadel/server": minor
---

`POST /auth_attempts` and `POST /sessions/exchange` take the project from the project secret and answer `403` with `proj.mismatch` when the request names a different project. Auth attempts store sealed `deployment_id` and `release_id` when a runtime resolution is on the create path (for example flow start); later attempt ops and handoff exchange refuse with `409` `rel.revoked` if that release was revoked since create.
