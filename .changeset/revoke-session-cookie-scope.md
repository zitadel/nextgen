---
"@zitadel/server": patch
---

Stop `DELETE /sessions/{session_id}` from clearing the caller's `__nextgen_session` cookie. Revoking a session by id is an operator action on someone else's session, so clearing the caller's cookie would sign the operator out; in the console it would destroy the admin's own session once the session list is wired to a live backend. Cookie clearing now happens only on `DELETE /sessions/me`, which acts on the cookie's own session.
