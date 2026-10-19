---
"@zitadel/server": minor
---

`POST /auth_attempts` and `POST /sessions/exchange` take the project from the project secret and answer `403` with `proj.mismatch` when the request names a different project. When a runtime resolution is available they seal `deployment_id` and `release_id` onto the attempt; later attempt ops and handoff exchange refuse with `409` `rel.revoked` if that release was revoked since create. With no browser `Origin`, resolution is skipped until the project default target lands — the same interim as `POST /flow`.
