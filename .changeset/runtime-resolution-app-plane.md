---
"@zitadel/server": minor
---

`POST /auth_attempts` and `POST /sessions/exchange` take the project from the project secret and answer `403` with `proj.mismatch` when the request names a different project. Auth attempts store sealed `deployment_id` and `release_id` when create runs with a runtime resolution on the context (the flow create path fills that via `RuntimeResolutionFromContext`); the public attempt HTTP ops do not re-check revoke themselves. Handoff exchange refuses a revoked sealed release inside the exchange transaction after handoff validation, so an invalid or expired token still answers `400` `sess.invalid_handoff_token`.
