---
"@zitadel/server": minor
---

Gate the operator session endpoints `GET /sessions`, `GET /sessions/{session_id}` and `DELETE /sessions/{session_id}`, which previously accepted any decryptable token and used the request's `project_id` unchecked. They now require a bearer bound to the requested project **and** an explicit `session.*` scope.

**Breaking:** the legacy `project.write` umbrella does not reach session management, because revoking sessions logs end users out rather than administering a project. No credential mints `session.*` yet, so these three endpoints answer `sess.permission_denied` (403) until the credential planes issue app-plane scopes. Session creation, handoff exchange, and the cookie-bound `/sessions/me` pair are unaffected.
