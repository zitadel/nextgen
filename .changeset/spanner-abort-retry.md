---
"@zitadel/server": patch
---

Fix sign-in intermittently failing with a session exchange conflict on Spanner. Spanner
aborts read-write transactions when they contend, and the client retries them
automatically, but the session exchange discarded the abort while reporting the
conflict, so the retry never ran and the request failed instead. Read-write
transactions also now run under a default 30 second deadline, so a contended
transaction fails clearly rather than retrying indefinitely.
