---
"@zitadel/server": patch
---

The login identifier step no longer slows down as a project gains users. On SQLite it took over 10 seconds with 10,000 users and did not finish above about 20,000; it now stays under a millisecond. Deleting a user in a large project is faster too.
