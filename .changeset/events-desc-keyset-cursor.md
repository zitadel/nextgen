---
"@zitadel/server": patch
---

Fix descending keyset pagination on `GET /events`: the page cursor was marshaled without its sort direction, so it defaulted to ascending and the second page of a `order=desc` listing was rejected with a cursor/order mismatch. The three dialect list statements now record the direction on the cursor, and a contract test covers descending paging across pages.
