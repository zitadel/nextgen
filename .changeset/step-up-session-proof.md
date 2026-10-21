---
"@zitadel/server": patch
---

Step-up sign-in now requires proof that the caller holds the session. `POST /auth_attempts` and `POST /flow` take a new `session_token` field. A request that names an existing `session_id` must also send that session's `session_token`, as `POST /sessions` or `POST /sessions/exchange` returned it. A request that sends only `session_token` runs against the token's session. Before this, a `session_id` alone was accepted. The new attempt then inherited that session's verified factors, so a caller who knew a session id but did not hold the session could complete a step-up on it and receive a fresh session token. A `session_id` without a matching `session_token` of the same project is now refused with `400` (`att.invalid_request` on attempts, `req.invalid` on flows).
