---
"@zitadel/server": patch
---

`GET /flow_definitions` now bounds its result set. A request that omits `limit` returned every flow definition in the project; it now returns the same default page of 20 as the other list endpoints, capped at 100, and hands back a `next_page_token` to walk the rest.
