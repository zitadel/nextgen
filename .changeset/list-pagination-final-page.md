---
"@zitadel/server": patch
---

Fix `next_page_token` on list endpoints so it is absent on the final page, as documented. Previously a token was returned whenever a page came back full, so when the total number of results was an exact multiple of the page size the last page still carried a token whose follow-up page was empty. List queries now look one row ahead within the same query (no extra round trip) and emit a token only when a further row actually exists.
