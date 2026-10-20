---
"@zitadel/server": patch
---

A login identifier submitted through a login flow now resolves only among the users of the flow's user schema, across all its revisions. A value held only by a user of another schema is reported as user not found, and the same value on another schema no longer makes the sign-in fail.
