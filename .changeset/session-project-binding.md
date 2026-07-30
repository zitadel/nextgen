---
"@zitadel/server": patch
---

Bind operator session endpoints to the caller's project: `GET`/`DELETE /sessions/{session_id}` and `GET /sessions` now require a bearer whose project matches the request's `project_id`. A valid token for project A can no longer read or revoke a session in project B by id.
