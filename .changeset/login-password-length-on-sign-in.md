---
"@zitadel/server": patch
---

Signing in no longer rejects a password as "too short". The minimum length now applies only where a password is chosen (registration and recovery), so a user whose existing password is shorter than the minimum can sign in, and a wrong short password gets the usual invalid-credentials error.
