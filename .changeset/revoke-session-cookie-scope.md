---
"@zitadel/server": patch
---

Stop `DELETE /sessions/{session_id}` from clearing the caller's `__nextgen_session` cookie. Revoking a session by id is an operator action on someone else's session, so clearing the caller's cookie signed the operator out — in the console, revoking any session from the session list destroyed the admin's own session. Cookie clearing now happens only on `DELETE /sessions/me`, which acts on the cookie's own session.
