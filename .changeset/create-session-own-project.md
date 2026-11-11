---
"@zitadel/server": patch
---

`POST /sessions` now creates a session only in the project of the secret that calls it. A `project_id` naming any other project is refused with `403 proj.mismatch`, and no session, session token or audit event is written. Before this, any project secret could create an anonymous session in another project, receive a session token for it and write `session.established` and `auth.token.issued` events into that project's audit log.
