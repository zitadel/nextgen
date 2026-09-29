---
"@zitadel/server": patch
---

Fix descending keyset pagination on `GET /events`: newest-first listings (`order=desc`) failed on the second page with a cursor/order mismatch, because the page cursor did not carry its sort direction. Paging through an `order=desc` result now works across every page.
